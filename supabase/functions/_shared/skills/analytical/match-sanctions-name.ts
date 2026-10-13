/**
 * @skill match-sanctions-name
 * @type analytical
 * @description Fuzzy name matching for sanctions screening, modelled on OFAC's
 *   Sanctions List Search (FAQ 249) and OpenSanctions' `ofac` matcher:
 *     1. whole-name score: Jaro-Winkler on the full normalized name
 *     2. name-part score: each word of either name is matched to its best word
 *        in the other (Jaro-Winkler, raised to 0.90 when Soundex codes agree),
 *        averaged by word length; list-name words count half (patronymics and
 *        initials a tenth), so a missing middle name lowers the score a little
 *        and a much longer list name a lot
 *   Every word of the screened name must have a counterpart (≥ 0.8) in the list
 *   name, or the score is capped below review: "John Smith" no longer matches
 *   "John Numbi". A name of three or more words may carry one extra word; a
 *   one-word name must match at 0.96 or better ("Tesco" and "Tesla" are not "TESA").
 *   Soundex only counts on words of five or more letters.
 *   The higher of the two is the score, taken over the list name and every alias.
 *   Word order does not matter in (2), so "Volkhovsky Dmitri" still matches.
 *   Names are folded to plain lowercase letters (accents removed); for entities,
 *   legal-form words (Ltd, LLC, GmbH, FZE, OOO …) are ignored.
 *   Non-Latin scripts are not transliterated here; lists carry Latin aliases.
 *   Thresholds are not set here: callers apply onboarding.screening settings
 *   (review ≥ 0.85; hit ≥ 0.97 with matching country). The agent never clears
 *   a match on its own; a person disposes every one.
 *
 * @input  screened name, subject type, prepared list (prepareSanctionsList)
 * @output best SanctionsMatch or null
 * @usedBy onboarding pipeline screening (_shared/onboarding/pipeline.ts), portfolio re-screening (planned)
 */

export interface ListEntry {
  list: string;
  name: string;
  type: "entity" | "person";
  aliases?: string[];
  country_code?: string;
  date_of_birth?: string;
  list_id?: string;
}

interface PreparedName { text: string; tokens: string[]; codes: string[] }
export interface PreparedEntry { entry: ListEntry; names: PreparedName[] }

export interface SanctionsMatch {
  entry: ListEntry;
  matched_name: string;
  score: number;
}

const LEGAL_FORMS = new Set([
  "ltd", "limited", "llc", "l", "inc", "incorporated", "corp", "corporation", "co", "company", "plc", "lp", "llp",
  "gmbh", "ag", "kg", "sa", "sas", "sarl", "srl", "spa", "bv", "nv", "ab", "as", "oy", "aps", "fze", "fzco", "fzc",
  "ooo", "oao", "zao", "pao", "jsc", "ojsc", "cjsc", "pjsc", "pte", "pty", "sdn", "bhd", "kk", "the",
]);

export function normalize(name: string, type: "entity" | "person"): string[] {
  const words = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  if (type !== "entity") return words;
  const kept = words.filter((w) => !LEGAL_FORMS.has(w));
  return kept.length ? kept : words;
}

function prepare(name: string, type: "entity" | "person"): PreparedName {
  const tokens = normalize(name, type);
  return { text: tokens.join(" "), tokens, codes: tokens.map(soundex) };
}

export function prepareSanctionsList(entries: ListEntry[]): PreparedEntry[] {
  return entries.map((entry) => ({
    entry,
    names: [entry.name, ...(entry.aliases ?? [])].filter(Boolean).map((n) => prepare(n, entry.type)),
  }));
}

/** Weight of list-name words the screened name does not contain (middle names,
 *  patronymics). Below 1 so "Viktor Vekselberg" still matches
 *  "Viktor Feliksovich Vekselberg"; above 0 so "Maria Garcia" no longer equals
 *  "Maria Del Rosario Garcia Duran". */
export const CANDIDATE_WORD_WEIGHT = 0.5;

/** Soundex only boosts words of 5+ letters: on short words it equates too much
 *  ("tesco" / "tesa", both T200). */
function tokenScore(a: string, ca: string, b: string, cb: string): number {
  let s = jaroWinkler(a, b);
  if (a.length >= 5 && b.length >= 5 && ca === cb) s = Math.max(s, 0.9);
  return s;
}

/** A one-word name ("Tesco", "Gazprom") carries little evidence, so its word must
 *  match almost exactly. */
export const SINGLE_WORD_MIN = 0.96;

function bestPerToken(from: PreparedName, to: PreparedName): number[] {
  return from.tokens.map((t, i) => {
    let best = 0;
    to.tokens.forEach((u, j) => { const s = tokenScore(t, from.codes[i], u, to.codes[j]); if (s > best) best = s; });
    return best;
  });
}

/** A word "has a counterpart" when its best match in the other name scores at least this. */
export const TOKEN_MATCH_MIN = 0.8;
/** Score given when the word rule fails: below any sensible review threshold. */
const NO_MATCH_CAP = 0.8;

/** Patronymics (-ovich, -evna …) and initials are routinely left out of applications. */
function candidateWeight(token: string): number {
  if (token.length <= 1) return 0.1;
  if (token.length > 6 && /(ovich|evich|yevich|ovych|ovna|evna|yevna|ivna|ich)$/.test(token)) return 0.1;
  return CANDIDATE_WORD_WEIGHT;
}

export function nameScore(query: PreparedName, cand: PreparedName): number {
  if (!query.text || !cand.text) return 0;
  const fwd = bestPerToken(query, cand), bwd = bestPerToken(cand, query);

  // Every word of the screened name needs a counterpart in the list name; a name of
  // three or more words may carry one extra word (a middle name the list lacks).
  const n = query.tokens.length;
  const matched = fwd.filter((x) => x >= TOKEN_MATCH_MIN).length;
  const wordsOk = n === 1 ? fwd[0] >= SINGLE_WORD_MIN
    : n === 2 ? matched === n
    : matched >= Math.max(2, n - 1);

  const whole = jaroWinkler(query.text, cand.text);
  let num = 0, den = 0;
  query.tokens.forEach((t, i) => { num += fwd[i] * t.length; den += t.length; });
  cand.tokens.forEach((t, j) => { const w = candidateWeight(t); num += bwd[j] * t.length * w; den += t.length * w; });
  const parts = den ? num / den : 0;
  const score = Math.max(whole, parts);
  return wordsOk ? score : Math.min(score, NO_MATCH_CAP);
}

export function matchSanctionsName(
  name: string, type: "entity" | "person", list: PreparedEntry[], minScore: number,
): SanctionsMatch | null {
  const q = prepare(name, type);
  if (!q.text) return null;
  let best: SanctionsMatch | null = null;
  for (const p of list) {
    if (p.entry.type !== type) continue;
    for (const n of p.names) {
      const s = nameScore(q, n);
      if (s >= minScore && (!best || s > best.score)) best = { entry: p.entry, matched_name: n.text, score: s };
    }
  }
  return best;
}

export function similarity(a: string, b: string, type: "entity" | "person" = "person"): number {
  return nameScore(prepare(a, type), prepare(b, type));
}

// ─── String measures ─────────────────────────────────────────────────────────

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  if (!la || !lb) return 0;
  const range = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const ma = new Array(la).fill(false), mb = new Array(lb).fill(false);
  let m = 0;
  for (let i = 0; i < la; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(lb, i + range + 1); j++) {
      if (mb[j] || a[i] !== b[j]) continue;
      ma[i] = mb[j] = true; m++; break;
    }
  }
  if (!m) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < la; i++) {
    if (!ma[i]) continue;
    while (!mb[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (m / la + m / lb + (m - t / 2) / m) / 3;
  let prefix = 0;
  while (prefix < 4 && prefix < la && prefix < lb && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

const SOUNDEX: Record<string, string> = {
  b: "1", f: "1", p: "1", v: "1", c: "2", g: "2", j: "2", k: "2", q: "2", s: "2", x: "2", z: "2",
  d: "3", t: "3", l: "4", m: "5", n: "5", r: "6",
};

export function soundex(word: string): string {
  const w = word.replace(/[^a-z]/g, "");
  if (!w) return "";
  let out = w[0].toUpperCase();
  let prev = SOUNDEX[w[0]] ?? "";
  for (let i = 1; i < w.length && out.length < 4; i++) {
    const c = w[i];
    const code = SOUNDEX[c] ?? "";
    if (code && code !== prev) out += code;
    if (c !== "h" && c !== "w") prev = code;
  }
  return out.padEnd(4, "0");
}
