/**
 * Parsers for the official sanctions list downloads (verified against the
 * real files of 2026-10-12). Each returns one ParsedEntry per listed person or
 * entity, with aliases. Ships, vessels and aircraft are skipped: a trade-credit
 * applicant or its people are only ever an entity or a person.
 *
 * Weak aliases are excluded, as OFAC allows (weak AKAs need not be screened)
 * and as the lists themselves mark them: UK "Low quality a.k.a", UN QUALITY "Low".
 * They are single words like "Mudir" or "Jundi" and would flood reviews.
 *
 * Country is the person's nationality (else first address country) or the
 * entity's first address country, as an ISO 3166 alpha-2 code. The hit rule
 * needs it: no country means a near-exact name match goes to review, never fail.
 */

export type ListName = "OFAC_SDN" | "OFAC_CONS" | "EU" | "UK" | "UN";

export interface ParsedEntry {
  list_id: string;
  type: "entity" | "person";
  name: string;
  aliases: string[];
  country_code?: string;
  date_of_birth?: string;
  programs?: string[];
}

const OFAC = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports";
export const SOURCES: Record<ListName, { urls: string[]; min_entries: number }> = {
  OFAC_SDN: { urls: [`${OFAC}/SDN.CSV`, `${OFAC}/ALT.CSV`, `${OFAC}/ADD.CSV`], min_entries: 5000 },
  OFAC_CONS: { urls: [`${OFAC}/CONS_PRIM.CSV`, `${OFAC}/CONS_ALT.CSV`, `${OFAC}/CONS_ADD.CSV`], min_entries: 50 },
  EU: { urls: ["https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw"], min_entries: 3000 },
  UK: { urls: ["https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.xml"], min_entries: 3000 },
  UN: { urls: ["https://scsanctions.un.org/resources/xml/en/consolidated.xml"], min_entries: 500 },
};

export const PARSERS: Record<ListName, (files: string[]) => ParsedEntry[]> = {
  OFAC_SDN: ([prim, alt, add]) => parseOfacCsv(prim, alt, add),
  OFAC_CONS: ([prim, alt, add]) => parseOfacCsv(prim, alt, add),
  EU: ([xml]) => parseEu(xml),
  UK: ([xml]) => parseUk(xml),
  UN: ([xml]) => parseUn(xml),
};

// ─── OFAC (SDN.CSV / ALT.CSV / ADD.CSV; consolidated non-SDN has the same layout) ──
// SDN.CSV: ent_num, name, type ("individual" | "-0-" entity | vessel | aircraft), program,
//          title, call sign, vessel type, tonnage, GRT, flag, owner, remarks.  "-0-" = empty.
// ALT.CSV: ent_num, alt_num, alt_type (aka/fka/nka), alt_name, remarks.
// ADD.CSV: ent_num, add_num, address, city/state, country, remarks.

export function parseOfacCsv(prim: string, alt: string, add: string): ParsedEntry[] {
  const aliases = new Map<string, string[]>();
  for (const r of parseCsv(alt)) {
    const name = val(r[3]);
    if (!name) continue;
    const list = aliases.get(r[0]) ?? [];
    list.push(name);
    aliases.set(r[0], list);
  }
  const countries = new Map<string, string>();
  for (const r of parseCsv(add)) {
    const c = countryCode(val(r[4]));
    if (c && !countries.has(r[0])) countries.set(r[0], c);
  }
  const out: ParsedEntry[] = [];
  for (const r of parseCsv(prim)) {
    if (r.length < 12) continue;
    const kind = val(r[2]);
    if (kind === "vessel" || kind === "aircraft") continue;
    const type = kind === "individual" ? "person" : "entity";
    const fix = (n: string) => (type === "person" ? ofacPersonName(n) : n);
    const remarks = val(r[11]) ?? "";
    const nationality = remarks.match(/(?:nationality|citizen) ([^;.]+)/i)?.[1];
    out.push({
      list_id: r[0], type, name: fix(val(r[1]) ?? ""),
      aliases: dedupe((aliases.get(r[0]) ?? []).map(fix)),
      country_code: (type === "person" ? countryCode(nationality) : undefined) ?? countries.get(r[0]),
      date_of_birth: remarks.match(/DOB ([^;]+)/)?.[1]?.trim(),
      programs: (val(r[3]) ?? "").replace(/^\[|\]$/g, "").split(/\]\s*\[/).map((p) => p.trim()).filter(Boolean),
    });
  }
  return out.filter((e) => e.name);
}

/** OFAC writes people as "SURNAME, Given Names"; screening wants natural order. */
export function ofacPersonName(n: string): string {
  const i = n.indexOf(",");
  return i < 0 ? n.trim() : `${n.slice(i + 1).trim()} ${n.slice(0, i).trim()}`;
}

// ─── EU Financial Sanctions Files (xmlFullSanctionsList_1_1) ───────────────────

export function parseEu(xml: string): ParsedEntry[] {
  const out: ParsedEntry[] = [];
  for (const block of blocks(xml, "sanctionEntity")) {
    const open = block.slice(0, block.indexOf(">") + 1);
    const code = attr(block.match(/<subjectType [^>]*>/)?.[0] ?? "", "code");
    if (code !== "person" && code !== "enterprise") continue;
    const type = code === "person" ? "person" : "entity";
    const names = dedupe([...block.matchAll(/<nameAlias [^>]*>/g)].map((m) => {
      const t = m[0];
      return attr(t, "wholeName") || [attr(t, "firstName"), attr(t, "middleName"), attr(t, "lastName")].filter(Boolean).join(" ");
    }).filter(Boolean));
    if (!names.length) continue;
    const iso = (tag: string) => [...block.matchAll(new RegExp(`<${tag} [^>]*>`, "g"))]
      .map((m) => attr(m[0], "countryIso2Code")).find((c) => c && c !== "00");
    const birth = block.match(/<birthdate [^>]*>/)?.[0] ?? "";
    out.push({
      list_id: attr(open, "euReferenceNumber") || attr(open, "logicalId"),
      type, name: names[0], aliases: names.slice(1),
      country_code: (type === "person" ? iso("citizenship") : undefined) ?? iso("address"),
      date_of_birth: attr(birth, "birthdate") || attr(birth, "year") || undefined,
      programs: dedupe([...block.matchAll(/<regulation [^>]*>/g)].map((m) => attr(m[0], "programme")).filter(Boolean)),
    });
  }
  return out;
}

// ─── UK Sanctions List (UK-Sanctions-List.xml) ─────────────────────────────────

export function parseUk(xml: string): ParsedEntry[] {
  const out: ParsedEntry[] = [];
  for (const block of blocks(xml, "Designation")) {
    const kind = text(block, "IndividualEntityShip");
    if (kind !== "Individual" && kind !== "Entity") continue;
    const type = kind === "Individual" ? "person" : "entity";
    let primary = "";
    const aliases: string[] = [];
    for (const n of blocks(block, "Name")) {
      const full = [1, 2, 3, 4, 5, 6].map((i) => text(n, `Name${i}`)).filter(Boolean).join(" ");
      if (!full) continue;
      const nameType = (text(n, "NameType") ?? "").toLowerCase();
      if (/low quality/i.test(text(n, "AliasStrength") ?? "")) continue;
      if (nameType === "primary name" && !primary) primary = full;
      else aliases.push(full);
    }
    if (!primary) primary = aliases.shift() ?? "";
    if (!primary) continue;
    const dob = text(block, "DOB");
    out.push({
      list_id: text(block, "UniqueID") ?? "", type, name: primary, aliases: dedupe(aliases).filter((a) => a !== primary),
      country_code: (type === "person" ? countryCode(text(block, "Nationality")) : undefined) ?? countryCode(text(block, "AddressCountry")),
      date_of_birth: dob ? dob.replace(/^dd\/mm\//, "").replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, "$3-$2-$1") : undefined,
      programs: dedupe(texts(block, "RegimeName")),
    });
  }
  return out.filter((e) => e.list_id);
}

// ─── UN Security Council Consolidated List (consolidated.xml) ──────────────────

export function parseUn(xml: string): ParsedEntry[] {
  const out: ParsedEntry[] = [];
  const goodAliases = (block: string, tag: string) => blocks(block, tag)
    .filter((a) => (text(a, "QUALITY") ?? "").toLowerCase() !== "low")
    .map((a) => text(a, "ALIAS_NAME") ?? "").filter(Boolean);
  for (const b of blocks(xml, "INDIVIDUAL")) {
    const name = ["FIRST_NAME", "SECOND_NAME", "THIRD_NAME", "FOURTH_NAME"].map((t) => text(b, t)).filter(Boolean).join(" ");
    if (!name) continue;
    const dob = blocks(b, "INDIVIDUAL_DATE_OF_BIRTH")[0] ?? "";
    out.push({
      list_id: text(b, "REFERENCE_NUMBER") ?? text(b, "DATAID") ?? "",
      type: "person", name, aliases: dedupe(goodAliases(b, "INDIVIDUAL_ALIAS")),
      country_code: countryCode(text(blocks(b, "NATIONALITY")[0] ?? "", "VALUE")) ?? countryCode(text(b, "COUNTRY")),
      date_of_birth: text(dob, "DATE") ?? text(dob, "YEAR"),
      programs: dedupe(texts(b, "UN_LIST_TYPE")),
    });
  }
  for (const b of blocks(xml, "ENTITY")) {
    const name = ["FIRST_NAME", "SECOND_NAME", "THIRD_NAME", "FOURTH_NAME"].map((t) => text(b, t)).filter(Boolean).join(" ");
    if (!name) continue;
    out.push({
      list_id: text(b, "REFERENCE_NUMBER") ?? text(b, "DATAID") ?? "",
      type: "entity", name, aliases: dedupe(goodAliases(b, "ENTITY_ALIAS")),
      country_code: countryCode(text(b, "COUNTRY")),
      programs: dedupe(texts(b, "UN_LIST_TYPE")),
    });
  }
  return out.filter((e) => e.list_id);
}

// ─── Small XML / CSV helpers (the files are regular; no general XML parser needed) ─

function blocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?=[\\s>])[^>]*>[\\s\\S]*?</${tag}>`, "g");
  return xml.match(re) ?? [];
}
function text(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  const v = m ? decode(m[1]).trim() : "";
  return v || undefined;
}
function texts(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, "g"))].map((m) => decode(m[1]).trim()).filter(Boolean);
}
function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? decode(m[1]).trim() : "";
}
function decode(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_m, e: string) => {
    const k = e.toLowerCase();
    if (k === "amp") return "&"; if (k === "lt") return "<"; if (k === "gt") return ">";
    if (k === "quot") return '"'; if (k === "apos") return "'";
    return String.fromCodePoint(k.startsWith("#x") ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
  });
}
function val(s: string | undefined): string | undefined {
  const v = (s ?? "").trim();
  return v && v !== "-0-" ? v : undefined;
}
function dedupe(xs: string[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const x of xs) { const k = x.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
}

export function parseCsv(src: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQ = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQ) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0].trim()) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); if (row.length > 1) rows.push(row); }
  return rows;
}

// ─── Country names used by OFAC, UK and UN → ISO 3166-1 alpha-2 ────────────────

const COUNTRIES: Record<string, string> = {
  "afghanistan": "AF", "albania": "AL", "algeria": "DZ", "angola": "AO", "antigua and barbuda": "AG", "argentina": "AR",
  "armenia": "AM", "aruba": "AW", "australia": "AU", "austria": "AT", "azerbaijan": "AZ", "bahamas": "BS", "bahamas, the": "BS",
  "bahrain": "BH", "bangladesh": "BD", "barbados": "BB", "belarus": "BY", "belgium": "BE", "belize": "BZ", "benin": "BJ",
  "bermuda": "BM", "bolivia": "BO", "bosnia and herzegovina": "BA", "brazil": "BR", "british virgin islands": "VG",
  "virgin islands, british": "VG", "bulgaria": "BG", "burkina faso": "BF", "burma": "MM", "myanmar": "MM", "cabo verde": "CV",
  "cape verde": "CV", "cambodia": "KH", "cameroon": "CM", "canada": "CA", "cayman islands": "KY", "central african republic": "CF",
  "chad": "TD", "chile": "CL", "china": "CN", "china, hong kong special administrative region": "HK", "hong kong": "HK",
  "macau": "MO", "colombia": "CO", "comoros": "KM", "congo": "CG", "congo, republic of the": "CG",
  "congo (democratic republic)": "CD", "congo, democratic republic of the": "CD", "democratic republic of the congo": "CD",
  "costa rica": "CR", "cote d ivoire": "CI", "cote d'ivoire": "CI", "croatia": "HR", "cuba": "CU", "curacao": "CW",
  "cyprus": "CY", "czech republic": "CZ", "czechia": "CZ", "dprk": "KP", "democratic people's republic of korea": "KP",
  "korea, north": "KP", "north korea": "KP", "korea, south": "KR", "south korea": "KR", "denmark": "DK", "djibouti": "DJ",
  "dominica": "DM", "dominican republic": "DO", "ecuador": "EC", "egypt": "EG", "el salvador": "SV", "equatorial guinea": "GQ",
  "eritrea": "ER", "estonia": "EE", "ethiopia": "ET", "fiji": "FJ", "finland": "FI", "france": "FR", "gabon": "GA",
  "georgia": "GE", "germany": "DE", "ghana": "GH", "gibraltar": "GI", "greece": "GR", "guatemala": "GT", "guernsey": "GG",
  "guinea": "GN", "guinea-bissau": "GW", "guyana": "GY", "haiti": "HT", "honduras": "HN", "hungary": "HU", "iceland": "IS",
  "india": "IN", "indonesia": "ID", "iran": "IR", "iran (islamic republic of)": "IR", "iraq": "IQ", "ireland": "IE",
  "israel": "IL", "italy": "IT", "jamaica": "JM", "japan": "JP", "jersey": "JE", "jordan": "JO", "kazakhstan": "KZ",
  "kenya": "KE", "kosovo": "XK", "kuwait": "KW", "kyrgyzstan": "KG", "laos": "LA", "latvia": "LV", "lebanon": "LB",
  "liberia": "LR", "libya": "LY", "liechtenstein": "LI", "lithuania": "LT", "luxembourg": "LU", "malaysia": "MY",
  "maldives": "MV", "mali": "ML", "malta": "MT", "man, isle of": "IM", "isle of man": "IM", "marshall islands": "MH",
  "mauritania": "MR", "mauritius": "MU", "mexico": "MX", "moldova": "MD", "monaco": "MC", "mongolia": "MN",
  "montenegro": "ME", "morocco": "MA", "mozambique": "MZ", "namibia": "NA", "netherlands": "NL", "new zealand": "NZ",
  "nicaragua": "NI", "niger": "NE", "nigeria": "NG", "north macedonia": "MK", "north macedonia, the republic of": "MK",
  "norway": "NO", "occupied palestinian territories": "PS", "palestinian": "PS", "state of palestine": "PS",
  "west bank": "PS", "region: gaza": "PS", "region: north gaza": "PS", "region: northern gaza": "PS", "region: west bank": "PS",
  "oman": "OM", "pakistan": "PK", "palau": "PW", "panama": "PA", "paraguay": "PY", "peru": "PE", "philippines": "PH",
  "poland": "PL", "portugal": "PT", "qatar": "QA", "romania": "RO", "russia": "RU", "russian federation": "RU",
  "region: russia": "RU", "region: crimea": "UA", "region: iran": "IR", "region: northern mali": "ML", "rwanda": "RW",
  "saint kitts and nevis": "KN", "st kitts and nevis": "KN", "saint vincent and the grenadines": "VC", "st lucia": "LC",
  "saint lucia": "LC", "samoa": "WS", "san marino": "SM", "saudi arabia": "SA", "senegal": "SN", "serbia": "RS",
  "seychelles": "SC", "sierra leone": "SL", "singapore": "SG", "slovakia": "SK", "slovenia": "SI", "somalia": "SO",
  "south africa": "ZA", "south sudan": "SS", "spain": "ES", "sri lanka": "LK", "sudan": "SD", "suriname": "SR",
  "sweden": "SE", "switzerland": "CH", "syria": "SY", "syrian arab republic": "SY", "taiwan": "TW", "tajikistan": "TJ",
  "tanzania": "TZ", "united republic of tanzania": "TZ", "thailand": "TH", "the gambia": "GM", "gambia": "GM", "togo": "TG",
  "trinidad and tobago": "TT", "tunisia": "TN", "turkey": "TR", "türkiye": "TR", "turkiye": "TR", "turkmenistan": "TM",
  "uganda": "UG", "ukraine": "UA", "united arab emirates": "AE", "united kingdom": "GB",
  "united kingdom of great britain and northern ireland": "GB", "united states": "US", "united states of america": "US",
  "uruguay": "UY", "uzbekistan": "UZ", "vanuatu": "VU", "venezuela": "VE", "viet nam": "VN", "vietnam": "VN",
  "yemen": "YE", "zambia": "ZM", "zimbabwe": "ZW",
};

export function countryCode(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const k = name.trim().toLowerCase().replace(/\s+/g, " ");
  return COUNTRIES[k];
}
