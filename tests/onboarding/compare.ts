/**
 * Partial-match comparator for golden expectations.
 *
 *   key: value            exact (deep) equality
 *   <name>_include: [...] actual <name> must contain every listed item
 *   <name>_count: n       actual <name> must have length n
 *   hit: {...}            partial match against the first screening hit
 *   absent: ["screening"] those outcome sections must not exist
 */
import { isDeepStrictEqual } from "util";

export function compare(actual: any, expect: any, path = ""): string[] {
  const out: string[] = [];
  for (const [k, want] of Object.entries(expect ?? {})) {
    const where = path ? `${path}.${k}` : k;
    if (k === "absent") {
      for (const sec of want as string[]) if (actual?.[sec] !== undefined) out.push(`${sec}: should not exist yet`);
      continue;
    }
    if (k.endsWith("_include")) {
      const base = k.slice(0, -"_include".length);
      const arr = actual?.[base];
      if (!Array.isArray(arr)) { out.push(`${path ? path + "." : ""}${base}: missing (expected to include ${JSON.stringify(want)})`); continue; }
      for (const item of want as any[]) if (!arr.some((a) => isDeepStrictEqual(a, item))) out.push(`${path ? path + "." : ""}${base}: missing ${JSON.stringify(item)} (got ${JSON.stringify(arr)})`);
      continue;
    }
    if (k.endsWith("_count")) {
      const base = k.slice(0, -"_count".length);
      const plural = actual?.[base] ?? actual?.[base + "s"];
      const n = Array.isArray(plural) ? plural.length : undefined;
      if (n !== want) out.push(`${where}: expected ${want}, got ${n}`);
      continue;
    }
    if (k === "hit") {
      out.push(...compare(actual?.hits?.[0], want, `${path ? path + "." : ""}hits[0]`));
      continue;
    }
    const got = actual?.[k];
    if (want !== null && typeof want === "object" && !Array.isArray(want)) {
      if (got === undefined) { out.push(`${where}: missing`); continue; }
      out.push(...compare(got, want, where));
    } else if (!isDeepStrictEqual(got, want)) {
      out.push(`${where}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    }
  }
  return out;
}
