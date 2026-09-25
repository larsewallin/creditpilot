/**
 * @skill sector-exposure-direction
 * @type analytical
 * @description Static config mapping each sector to the economic indicators that
 *   apply to it, the verified FRED/BLS series ID backing each one, and whether
 *   the sector is a "producer" or "consumer" of the thing that indicator measures
 *   (or "self" when the indicator is the sector's own vital sign, not an external
 *   commodity/input it trades).
 *
 *   Every series ID here was individually verified to resolve to a real FRED
 *   series before being added — none are guessed. Coverage is intentionally not
 *   exhaustive: only sector/indicator pairs with a verified series are included.
 *   'Other' has no entries (no single economic indicator applies to a catch-all
 *   sector) — the Industry Risk Monitor simply has no signal source for it.
 *
 *   Role determines sign normalization via normalizeChangePercent():
 *     'self'     — the indicator IS the sector's own output/employment/capacity.
 *                   A raw decline is always deterioration. No flip.
 *     'producer' — the sector sells the thing this indicator prices (e.g. Energy
 *                   selling oil, Materials selling steel). Rising price is good
 *                   for them, so a raw decline (falling price) is deterioration.
 *                   No flip — the raw series' sign already means what it should.
 *     'consumer' — the sector buys the thing this indicator prices as an input
 *                   (e.g. Transportation buying fuel, Industrial Manufacturing
 *                   buying steel). Rising price is bad for them (higher costs),
 *                   so the raw sign must be flipped: a raw increase becomes a
 *                   negative (deteriorating) normalized value.
 *
 * @usedBy industry-risk-agent
 */

export type ExposureRole = "self" | "producer" | "consumer";

export interface SectorIndicatorConfig {
  sector: string;
  indicator: "production_output" | "producer_prices" | "employment" | "commodity_price" | "capacity_utilization";
  source_series: string;
  role: ExposureRole;
}

// Every entry verified against https://fred.stlouisfed.org/series/<id> before
// inclusion — see the Phase 3 build notes in the deferred backlog for the
// verification pass.
export const SECTOR_INDICATOR_CONFIG: SectorIndicatorConfig[] = [
  { sector: "Aerospace & Defense",       indicator: "production_output",    source_series: "FRED:IPG3364S",      role: "self" },

  { sector: "Energy",                    indicator: "production_output",    source_series: "FRED:IPG211S",       role: "self" },
  { sector: "Energy",                    indicator: "commodity_price",      source_series: "FRED:DCOILWTICO",    role: "producer" },
  { sector: "Energy",                    indicator: "producer_prices",      source_series: "FRED:PCU211211",     role: "producer" },
  { sector: "Energy",                    indicator: "employment",           source_series: "FRED:CES1021100001", role: "self" },

  { sector: "Industrial Manufacturing",  indicator: "production_output",    source_series: "FRED:IPMAN",         role: "self" },
  { sector: "Industrial Manufacturing",  indicator: "commodity_price",      source_series: "FRED:WPU101",        role: "consumer" },

  { sector: "Materials",                 indicator: "production_output",    source_series: "FRED:IPG331S",       role: "self" },
  { sector: "Materials",                 indicator: "commodity_price",      source_series: "FRED:WPU101",        role: "producer" },
  { sector: "Materials",                 indicator: "capacity_utilization", source_series: "FRED:CAPUTLG331S",   role: "self" },

  { sector: "Mining",                    indicator: "production_output",    source_series: "FRED:IPG212S",       role: "self" },

  { sector: "Transportation",            indicator: "employment",           source_series: "FRED:CES4300000001", role: "self" },
  { sector: "Transportation",            indicator: "commodity_price",      source_series: "FRED:DCOILWTICO",    role: "consumer" },
];

export function getIndicatorsForSector(sector: string): SectorIndicatorConfig[] {
  return SECTOR_INDICATOR_CONFIG.filter((c) => c.sector === sector);
}

/**
 * Normalizes a raw % change from an economic series into "negative always
 * means deterioration for this sector's actual exposure" — see role
 * semantics above. Raw input is whatever direction the series itself reports
 * (e.g. DCOILWTICO rising = positive raw change_percent).
 */
export function normalizeChangePercent(rawChangePercent: number, role: ExposureRole): number {
  return role === "consumer" ? -rawChangePercent : rawChangePercent;
}
