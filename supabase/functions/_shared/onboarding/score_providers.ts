/**
 * Credit score sources a company can use, and how each one's own scale is put on
 * CreditPilot's common scale (0–100, higher = safer) for the limit bands and the
 * accounts-age rule.
 *
 * Keen is the default. A company that uses D&B, Creditsafe, Coface, Allianz Trade,
 * Experian or another provider puts it first in Settings › Credit score source; the
 * first source in that order with a score counts (never an average).
 *
 * How a provider's score arrives today: the credit team types it from the provider's
 * report on the application (value, date, the provider's credit recommendation).
 * A direct API connection per provider is added when a company brings its licence
 * (the `fetch` hook below); until then the source reads "entered".
 *
 * The conversions are linear maps of each provider's published scale onto 0–100. They
 * line scales up; they do not make the providers' risk levels equivalent.
 *   Creditsafe   Risk Score 1–100 (71–100 very low risk … 1–29 high risk), or the
 *                international A–D (A very low … D high; E not rated) → band midpoints
 *   D&B          Failure Score percentile 1–100 (higher = lower risk of failure)
 *   Experian     Intelliscore Plus 1–100 (V1/V2) or 300–850 (V3)
 *   Coface       Score 0–10 (10 = strongest, 0 = default)
 *   Allianz Trade Grade 1–10 (1 = solid, 10 = insolvency)
 */

export interface ScoreProvider {
  id: string;
  name: string;
  /** The provider's own scale, as shown next to the input. */
  scale: string;
  /** Provider value (number or text) → 0–100, higher = safer; null when not a score. */
  normalize(raw: unknown): number | null;
}

const num = (raw: unknown): number | null => {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const within = (n: number | null, lo: number, hi: number) => (n !== null && n >= lo && n <= hi ? n : null);

export const SCORE_PROVIDERS: ScoreProvider[] = [
  {
    id: "keen", name: "Keen", scale: "0–100 from the financial statements",
    normalize: (raw) => { const n = within(num(raw), 0, 100); return n === null ? null : clamp(n); },
  },
  {
    id: "dnb", name: "Dun & Bradstreet", scale: "Failure Score percentile 1–100 (higher is safer)",
    normalize: (raw) => { const n = within(num(raw), 1, 100); return n === null ? null : clamp(n); },
  },
  {
    id: "creditsafe", name: "Creditsafe", scale: "Risk Score 1–100, or international A–D",
    normalize: (raw) => {
      const letter = String(raw ?? "").trim().toUpperCase();
      const band: Record<string, number> = { A: 85, B: 60, C: 40, D: 15 };   // midpoints of 71–100, 51–70, 30–50, 1–29
      if (letter in band) return band[letter];
      const n = within(num(raw), 1, 100);
      return n === null ? null : clamp(n);
    },
  },
  {
    id: "experian", name: "Experian", scale: "Intelliscore Plus 1–100 (or 300–850 for V3)",
    normalize: (raw) => {
      const n = num(raw);
      if (n === null) return null;
      if (n >= 1 && n <= 100) return clamp(n);
      if (n >= 300 && n <= 850) return clamp(((n - 300) / 550) * 100);
      return null;
    },
  },
  {
    id: "coface", name: "Coface", scale: "Score 0–10 (10 is strongest)",
    normalize: (raw) => { const n = within(num(raw), 0, 10); return n === null ? null : clamp(n * 10); },
  },
  {
    id: "allianz_trade", name: "Allianz Trade", scale: "Grade 1–10 (1 is solid, 10 is insolvency)",
    normalize: (raw) => { const n = within(num(raw), 1, 10); return n === null ? null : clamp(((10 - n) / 9) * 100); },
  },
  {
    id: "other", name: "Other provider", scale: "Already on 0–100, higher is safer",
    normalize: (raw) => { const n = within(num(raw), 0, 100); return n === null ? null : clamp(n); },
  },
];

export const PROVIDER = Object.fromEntries(SCORE_PROVIDERS.map((p) => [p.id, p])) as Record<string, ScoreProvider>;

/** What Settings and the form show: id, name and scale. */
export const PROVIDER_LIST = SCORE_PROVIDERS.map(({ id, name, scale }) => ({ id, name, scale }));
