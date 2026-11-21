/** Every numeric field of a nested object, as dotted paths, in stored order. */
export function flatten(v: unknown, prefix = ""): [string, number][] {
  if (typeof v === "number") return [[prefix, v]];
  if (!v || typeof v !== "object" || Array.isArray(v)) return [];
  return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => flatten(x, prefix ? `${prefix}.${k}` : k));
}
