// The demo portfolio: one story per customer, every row built from it (plan: "CreditPilot demo
// data rewrite", founder 2026-11-22). Nothing here is a calendar date: each story says "issued 40
// days ago, net 45, paid 6 days late", and buildDemo(today) turns that into rows. Due date = issue
// date + terms, payment date = due date + lateness, an invoice not yet paid by today is open, and
// exposure is the open invoices — so payments, aging, exposure and limit use always agree.
//
// Every company is fictional (no real company, ticker or website; sites use example.com). Pure
// module: no database, no clock, no randomness beyond a seed per customer, so the same day always
// gives the same rows. Tests: __tests__/stories.test.ts.

export type Story =
  | "steady"
  | "slowing"
  | "over_limit"
  | "news_shock"
  | "going_concern"
  | "covenant_waiver"
  | "bankruptcy"
  | "score_drop"
  | "improving"
  | "strategic_slowing";

export interface DemoCustomer {
  n: number;                    // 1–40, gives the fixed id
  name: string;
  story: Story;
  country: "US" | "DE" | "GB" | "JP";
  city: string;
  industry: string;
  terms: 30 | 45 | 60;
  /** Typical invoice, in the invoicing currency's USD value. */
  invoice: number;
  /** Days between invoices. */
  cadence: number;
  /** Exposure ÷ limit at today, in %. Sets the limit. */
  limitUse: number;
  score: number;
  /** Score before the latest change; equal to score when nothing changed. */
  previousScore?: number;
  policyGroup?: "strategic" | "high_risk" | "export";
  sinceYear: number;
  /** For the expected proposal (story check). */
  expect: {
    events: string[];
    proposal: "none" | "hold" | "cut_to_owed" | "cut" | "cut_small";
    /** The proposal depends on a news event; news is read by the assistant, so CI cannot check it. */
    proposalNeedsNews?: boolean;
  };
}

const STEADY = { events: [], proposal: "none" } as const;

/** The 40 customers. 27 quiet, 13 with a story (plan, story table). */
export const DEMO_CUSTOMERS: DemoCustomer[] = [
  // ── Steady payers (27) ──────────────────────────────────────────────────────────────
  { n: 1, name: "Halvorsen Aerostructures Inc", story: "steady", country: "US", city: "Wichita", industry: "Aerospace components", terms: 45, invoice: 420_000, cadence: 14, limitUse: 55, score: 81, sinceYear: 2014, expect: STEADY },
  { n: 2, name: "Bramblecrest Hydraulics Corp", story: "steady", country: "US", city: "Cleveland", industry: "Industrial equipment", terms: 45, invoice: 160_000, cadence: 15, limitUse: 48, score: 74, sinceYear: 2017, expect: STEADY },
  { n: 3, name: "Quillon Avionics Corp", story: "steady", country: "US", city: "Melbourne, FL", industry: "Aerospace electronics", terms: 45, invoice: 230_000, cadence: 15, limitUse: 62, score: 78, sinceYear: 2016, expect: STEADY },
  { n: 4, name: "Stonebridge Valve Works Inc", story: "steady", country: "US", city: "Houston", industry: "Flow control", terms: 30, invoice: 85_000, cadence: 10, limitUse: 40, score: 69, sinceYear: 2019, expect: STEADY },
  { n: 5, name: "Corveth Composites LLC", story: "steady", country: "US", city: "Salt Lake City", industry: "Aerospace components", terms: 45, invoice: 120_000, cadence: 15, limitUse: 58, score: 72, sinceYear: 2018, expect: STEADY },
  { n: 6, name: "Pemberton Rail Logistics Inc", story: "steady", country: "US", city: "Omaha", industry: "Logistics", terms: 30, invoice: 60_000, cadence: 7, limitUse: 35, score: 76, sinceYear: 2015, expect: STEADY },
  { n: 7, name: "Ardent Turbine Services Inc", story: "steady", country: "US", city: "Greenville, SC", industry: "Energy equipment", terms: 60, invoice: 310_000, cadence: 20, limitUse: 66, score: 80, sinceYear: 2012, expect: STEADY },
  { n: 8, name: "Lakeshore Precision Gear Co", story: "steady", country: "US", city: "Milwaukee", industry: "Industrial equipment", terms: 45, invoice: 70_000, cadence: 14, limitUse: 44, score: 63, sinceYear: 2020, expect: STEADY },
  { n: 9, name: "Calloway Defense Systems Inc", story: "steady", country: "US", city: "Huntsville", industry: "Defense electronics", terms: 45, invoice: 540_000, cadence: 15, limitUse: 52, score: 86, policyGroup: "strategic", sinceYear: 2011, expect: STEADY },
  { n: 10, name: "Fairwind Energy Services Inc", story: "steady", country: "US", city: "Midland", industry: "Oilfield services", terms: 30, invoice: 140_000, cadence: 10, limitUse: 50, score: 66, sinceYear: 2018, expect: STEADY },
  { n: 11, name: "Ostrander Chemical Co", story: "steady", country: "US", city: "Baton Rouge", industry: "Specialty chemicals", terms: 45, invoice: 95_000, cadence: 14, limitUse: 38, score: 71, sinceYear: 2016, expect: STEADY },
  { n: 12, name: "Kestrel Motion Controls Inc", story: "steady", country: "US", city: "Rochester, NY", industry: "Industrial electronics", terms: 45, invoice: 55_000, cadence: 14, limitUse: 30, score: 77, sinceYear: 2021, expect: STEADY },
  { n: 13, name: "Wrenfield Packaging Corp", story: "steady", country: "US", city: "Atlanta", industry: "Packaging", terms: 30, invoice: 45_000, cadence: 7, limitUse: 42, score: 68, sinceYear: 2019, expect: STEADY },
  { n: 14, name: "Tamarind Coatings Inc", story: "steady", country: "US", city: "Charlotte", industry: "Specialty chemicals", terms: 30, invoice: 30_000, cadence: 10, limitUse: 28, score: 73, sinceYear: 2022, expect: STEADY },
  { n: 15, name: "Redmond Cargo Systems Inc", story: "steady", country: "US", city: "Memphis", industry: "Logistics", terms: 45, invoice: 110_000, cadence: 10, limitUse: 46, score: 70, sinceYear: 2017, expect: STEADY },
  { n: 16, name: "Abernathy Steel Fabricators Inc", story: "steady", country: "US", city: "Pittsburgh", industry: "Metal fabrication", terms: 45, invoice: 90_000, cadence: 14, limitUse: 51, score: 60, sinceYear: 2015, expect: STEADY },
  { n: 17, name: "Harrowgate Power Systems Inc", story: "steady", country: "US", city: "Schenectady", industry: "Energy equipment", terms: 60, invoice: 260_000, cadence: 20, limitUse: 60, score: 79, sinceYear: 2013, expect: STEADY },
  { n: 18, name: "Fenmoor Instruments Inc", story: "steady", country: "US", city: "Boulder", industry: "Industrial electronics", terms: 30, invoice: 40_000, cadence: 10, limitUse: 33, score: 75, sinceYear: 2020, expect: STEADY },
  { n: 19, name: "Glenrock Mining Supply Co", story: "steady", country: "US", city: "Elko", industry: "Mining equipment", terms: 45, invoice: 80_000, cadence: 14, limitUse: 47, score: 64, sinceYear: 2018, expect: STEADY },
  { n: 20, name: "Brennecke Antriebstechnik GmbH", story: "steady", country: "DE", city: "Stuttgart", industry: "Industrial equipment", terms: 45, invoice: 180_000, cadence: 15, limitUse: 54, score: 82, policyGroup: "export", sinceYear: 2016,
    expect: { events: ["RISK_CHANGE"], proposal: "none" } }, // the German exposure the risk agent maps (country, currency, industry)
  { n: 21, name: "Elbwerk Logistik GmbH", story: "steady", country: "DE", city: "Hamburg", industry: "Logistics", terms: 30, invoice: 75_000, cadence: 10, limitUse: 41, score: 72, policyGroup: "export", sinceYear: 2019, expect: STEADY },
  { n: 22, name: "Wexford Marine Engineering Ltd", story: "steady", country: "GB", city: "Southampton", industry: "Marine engineering", terms: 45, invoice: 130_000, cadence: 15, limitUse: 49, score: 70, policyGroup: "export", sinceYear: 2017, expect: STEADY },
  { n: 23, name: "Ashcombe Aero Parts Ltd", story: "steady", country: "GB", city: "Bristol", industry: "Aerospace components", terms: 45, invoice: 150_000, cadence: 15, limitUse: 57, score: 76, policyGroup: "export", sinceYear: 2015, expect: STEADY },
  { n: 24, name: "Sakuragawa Seiki K.K.", story: "steady", country: "JP", city: "Nagoya", industry: "Industrial equipment", terms: 60, invoice: 210_000, cadence: 20, limitUse: 63, score: 84, policyGroup: "export", sinceYear: 2014, expect: STEADY },
  { n: 25, name: "Hoshimi Denshi K.K.", story: "steady", country: "JP", city: "Osaka", industry: "Industrial electronics", terms: 60, invoice: 170_000, cadence: 20, limitUse: 59, score: 80, policyGroup: "export", sinceYear: 2016, expect: STEADY },
  { n: 26, name: "Kitaura Kaiun K.K.", story: "steady", country: "JP", city: "Kobe", industry: "Logistics", terms: 45, invoice: 120_000, cadence: 15, limitUse: 45, score: 73, policyGroup: "export", sinceYear: 2018, expect: STEADY },
  { n: 27, name: "Ridgeline Fabrication Inc", story: "steady", country: "US", city: "Tulsa", industry: "Metal fabrication", terms: 30, invoice: 50_000, cadence: 10, limitUse: 39, score: 58, sinceYear: 2020, expect: STEADY },

  // ── Stories (13) ────────────────────────────────────────────────────────────────────
  { n: 28, name: "Marlow Industrial Castings Inc", story: "slowing", country: "US", city: "Toledo", industry: "Metal fabrication", terms: 45, invoice: 95_000, cadence: 12, limitUse: 86, score: 52, sinceYear: 2016,
    expect: { events: ["PAYMENT_DETERIORATION", "OVERDUE_AR", "UTILIZATION_THRESHOLD_BREACH"], proposal: "cut" } },
  { n: 29, name: "Dunmore Machine Tool Co", story: "slowing", country: "US", city: "Dayton", industry: "Industrial equipment", terms: 45, invoice: 60_000, cadence: 14, limitUse: 58, score: 57, sinceYear: 2018,
    expect: { events: ["PAYMENT_DETERIORATION", "OVERDUE_AR"], proposal: "none" } },
  { n: 30, name: "Vossberg Metallbau GmbH", story: "slowing", country: "DE", city: "Dortmund", industry: "Metal fabrication", terms: 45, invoice: 70_000, cadence: 15, limitUse: 62, score: 55, policyGroup: "export", sinceYear: 2017,
    expect: { events: ["PAYMENT_DETERIORATION", "OVERDUE_AR"], proposal: "none" } },
  { n: 31, name: "Carrick Process Equipment Inc", story: "over_limit", country: "US", city: "Birmingham, AL", industry: "Industrial equipment", terms: 30, invoice: 85_000, cadence: 10, limitUse: 124, score: 41, policyGroup: "high_risk", sinceYear: 2019,
    expect: { events: ["UTILIZATION_THRESHOLD_BREACH", "OVERDUE_AR", "PAYMENT_DETERIORATION"], proposal: "cut" } },
  { n: 32, name: "Pellham Freight Group Inc", story: "over_limit", country: "US", city: "Columbus, OH", industry: "Logistics", terms: 30, invoice: 55_000, cadence: 7, limitUse: 112, score: 61, sinceYear: 2021,
    expect: { events: ["UTILIZATION_THRESHOLD_BREACH"], proposal: "none" } },
  { n: 33, name: "Thornbury Electrical Supply Inc", story: "news_shock", country: "US", city: "Indianapolis", industry: "Electrical distribution", terms: 45, invoice: 110_000, cadence: 10, limitUse: 84, score: 62, sinceYear: 2015,
    expect: { events: ["NEWS_EVENT"], proposal: "cut", proposalNeedsNews: true } },
  { n: 34, name: "Ellsworth Plastics Molding Inc", story: "news_shock", country: "US", city: "Grand Rapids", industry: "Plastics", terms: 45, invoice: 50_000, cadence: 14, limitUse: 47, score: 59, sinceYear: 2019,
    expect: { events: ["NEWS_EVENT"], proposal: "none" } },
  { n: 35, name: "Solenne Battery Technologies Inc", story: "going_concern", country: "US", city: "Reno", industry: "Energy storage", terms: 30, invoice: 70_000, cadence: 14, limitUse: 72, score: 21, previousScore: 44, sinceYear: 2021,
    expect: { events: ["GOING_CONCERN", "NEWS_EVENT", "CREDIT_RATING_DOWNGRADE", "PAYMENT_DETERIORATION", "OVERDUE_AR"], proposal: "cut_to_owed" } },
  { n: 36, name: "Granitefold Engineering Corp", story: "covenant_waiver", country: "US", city: "Denver", industry: "Engineering services", terms: 45, invoice: 140_000, cadence: 15, limitUse: 55, score: 54, sinceYear: 2014,
    expect: { events: ["SEC_OTHER"], proposal: "none" } }, // the SEC agent files covenant and CEO signals as SEC_OTHER
  { n: 37, name: "Brightwater Retail Fixtures Inc", story: "bankruptcy", country: "US", city: "Newark", industry: "Retail fixtures", terms: 45, invoice: 65_000, cadence: 10, limitUse: 80, score: 6, previousScore: 24, sinceYear: 2016,
    expect: { events: ["NEWS_EVENT", "CREDIT_RATING_DOWNGRADE", "PAYMENT_DETERIORATION"], proposal: "hold" } },
  { n: 38, name: "Ormsby Specialty Alloys Ltd", story: "score_drop", country: "GB", city: "Sheffield", industry: "Metal fabrication", terms: 45, invoice: 90_000, cadence: 15, limitUse: 50, score: 52, previousScore: 70, policyGroup: "export", sinceYear: 2016,
    expect: { events: ["CREDIT_RATING_DOWNGRADE"], proposal: "none" } },
  { n: 39, name: "Tidewell Water Systems Inc", story: "improving", country: "US", city: "Tampa", industry: "Flow control", terms: 45, invoice: 60_000, cadence: 14, limitUse: 46, score: 66, previousScore: 58, sinceYear: 2018,
    expect: { events: ["PAYMENT_IMPROVEMENT", "CREDIT_RATING_UPGRADE"], proposal: "none" } },
  { n: 40, name: "Larkspur Aerospace Holdings Inc", story: "strategic_slowing", country: "US", city: "Fort Worth", industry: "Aerospace components", terms: 45, invoice: 600_000, cadence: 10, limitUse: 82, score: 64, policyGroup: "strategic", sinceYear: 2010,
    expect: { events: ["PAYMENT_DETERIORATION", "OVERDUE_AR", "UTILIZATION_THRESHOLD_BREACH"], proposal: "cut_small" } },
];

export const BANKRUPTCY_FILED_DAYS_AGO = 21;
export const GRACE_DAYS = 5;
const HISTORY_DAYS = 240;

/** Fixed id per customer: d0000000-0000-4000-8000-0000000000NN. */
export function demoCustomerId(n: number): string {
  return `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** customers.scenario is the database's scenario_type list; the story itself lives here. */
const SCENARIO: Record<Story, string> = {
  steady: "normal_operations", improving: "normal_operations",
  slowing: "payment_issues", strategic_slowing: "payment_issues", over_limit: "payment_issues",
  news_shock: "negative_news", going_concern: "sec_filing_monitoring", covenant_waiver: "sec_filing_monitoring",
  bankruptcy: "bankruptcy", score_drop: "credit_deterioration",
};

/** customers.sector is the database's fixed list; the industry agent works by sector. */
const SECTOR: Record<string, string> = {
  "Aerospace components": "Aerospace & Defense", "Aerospace electronics": "Aerospace & Defense", "Defense electronics": "Aerospace & Defense",
  "Energy equipment": "Energy", "Oilfield services": "Energy", "Energy storage": "Energy",
  "Logistics": "Transportation", "Mining equipment": "Mining",
  "Specialty chemicals": "Materials", "Metal fabrication": "Materials",
};
export const sectorOf = (industry: string) => SECTOR[industry] ?? "Industrial Manufacturing";

const CURRENCY: Record<DemoCustomer["country"], string> = { US: "USD", DE: "EUR", GB: "GBP", JP: "JPY" };

/** Days late an invoice is paid (positive = late), by how many days ago it fell due. Timed from
 *  the due date, so the payments of the last 90 days show the story's behaviour now. */
export function latenessFor(c: DemoCustomer, dueDaysAgo: number, r: () => number): number {
  const jitter = Math.round((r() - 0.5) * 4); // ±2 days
  const recent = Math.min(1, Math.max(0, 1 - dueDaysAgo / 150)); // 0 five months ago → 1 today
  switch (c.story) {
    case "steady":
    case "covenant_waiver":
    case "score_drop":
      return Math.min(GRACE_DAYS - 1, -4 + jitter + (r() < 0.12 ? 5 : 0)); // early, now and then a few days late
    case "news_shock":
      return -2 + jitter;
    case "slowing":
      return Math.round(2 + 18 * recent) + jitter; // 2 → 20 days late
    case "strategic_slowing":
      return Math.round(2 + 16 * recent) + jitter; // 2 → 18
    case "over_limit":
      // The weak one stopped paying about 85 days ago (its oldest invoice is 61–90 days overdue)
      // after slowing; the other pays about on time but buys more than its limit.
      if (c.score >= 50) return 1 + jitter;
      return dueDaysAgo < 85 ? 120 : Math.round(30 - (dueDaysAgo - 85) / 4) + jitter;
    case "going_concern":
      return Math.round(4 + 26 * recent) + jitter;
    case "bankruptcy":
      return Math.round(15 + 30 * recent) + jitter;
    case "improving":
      return dueDaysAgo > 100 ? 16 + jitter : -3 + jitter; // late, then on time for the last 3 months
  }
}

// Deterministic per-customer random numbers (mulberry32).
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Latest accounts' period end, recent enough for the score (Settings › how old accounts may
 *  be: 15 months at 70+, 12, 9, 6 below 40): stronger customers send annual accounts, weaker ones
 *  half-year or quarterly accounts. A month end, 11 / 8 / 5 / 3 months before today. */
function yearEndFor(t0: Date, score: number): string {
  const back = score >= 70 ? 11 : score >= 55 ? 8 : score >= 40 ? 5 : 3;
  return new Date(Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth() - back + 1, 0)).toISOString().slice(0, 10);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const round = (x: number, to: number) => Math.round(x / to) * to;

export interface DemoRows {
  /** Industry, country and currency samples the portfolio agents read (one story each). */
  industryEcon: Record<string, unknown>[];
  industryNews: Record<string, unknown>[];
  /** Updates to seed_country_risk, by country code: one change (Japan's policy rate); the rest unchanged. */
  countryUpdates: { country_code: string; values: Record<string, unknown> }[];
  customers: Record<string, unknown>[];
  invoices: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  seedNews: Record<string, unknown>[];
  seedSecFilings: Record<string, unknown>[];
  secMonitoring: Record<string, unknown>[];
}

/** All demo rows for `today` (a date; only its calendar day is used). */
export function buildDemo(today: Date): DemoRows {
  const t0 = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const day = (n: number) => iso(addDays(t0, -n));
  const rows: DemoRows = {
    // Steel input costs up 18% over the year: a downturn signal for the industrial manufacturers
    // that buy it. One port labor dispute for the logistics customers. Both fictional, dated from today.
    industryEcon: [
      { sector: "Industrial Manufacturing", indicator: "commodity_price", source_series: "Demo series: steel input prices", observation_date: day(20), change_percent: 18, period_days: 365 },
    ],
    industryNews: [
      { sector: "Transportation", headline: "Port labor talks stall, raising the risk of a strike at two East Coast ports", summary: "Contract talks between dockworkers and port operators have stalled; shippers are rerouting some cargo ahead of a possible strike next month.", url: null, source: "Demo Newswire", published_date: day(5), disruption_type: "labor" },
    ],
    countryUpdates: [
      { country_code: "JP", values: { previous_policy_rate: 0.5, policy_rate: 0.75, rate_effective_date: day(12) } },
      { country_code: "DE", values: { previous_rating: "AAA", current_rating: "AAA", rating_outlook: "stable", rating_effective_date: day(400) } },
      { country_code: "US", values: { tariff_change_percent: null, tariff_affected_countries: null, tariff_affected_sectors: null, tariff_effective_date: null, tariff_summary: null } },
    ],
    customers: [], invoices: [], payments: [], seedNews: [], seedSecFilings: [], secMonitoring: [] };

  for (const c of DEMO_CUSTOMERS) {
    const id = demoCustomerId(c.n);
    const r = rng(c.n * 7919);
    const filedAgo = c.story === "bankruptcy" ? BANKRUPTCY_FILED_DAYS_AGO : null;
    const prefix = c.name.replace(/[^A-Z]/g, "").slice(0, 4).padEnd(4, "X");

    // Invoices every `cadence` days for the last 240 days (none after a bankruptcy filing).
    const issued: { ago: number; amount: number; late: number }[] = [];
    for (let ago = HISTORY_DAYS; ago >= 1; ago -= c.cadence) {
      if (filedAgo != null && ago < filedAgo) break;
      const amount = round(c.invoice * (0.75 + r() * 0.5), 500);
      issued.push({ ago, amount, late: latenessFor(c, ago - c.terms, r) });
    }

    let open = 0;
    let seq = 0;
    for (const inv of issued) {
      seq++;
      const invoiceDate = addDays(t0, -inv.ago);
      const dueDate = addDays(invoiceDate, c.terms);
      const paidDate = addDays(dueDate, inv.late);
      const number = `INV-${prefix}-${String(seq).padStart(4, "0")}`;
      const paidAgo = Math.round((t0.getTime() - paidDate.getTime()) / 86_400_000);
      const paidBeforeFiling = filedAgo == null || paidAgo > filedAgo;
      const isPaid = paidAgo >= 1 && paidBeforeFiling;
      const currency = CURRENCY[c.country];

      if (isPaid) {
        rows.payments.push({
          customer_id: id, invoice_number: number, payment_date: iso(paidDate), amount_paid: inv.amount,
          payment_method: "wire_transfer", invoice_date: iso(invoiceDate), invoice_due_date: iso(dueDate),
          days_to_pay: c.terms + inv.late, days_early_late: inv.late, on_time: inv.late <= GRACE_DAYS,
          is_partial_payment: false, posted_by: "demo", is_demo: true,
        });
      }
      const dueAgo = Math.round((t0.getTime() - dueDate.getTime()) / 86_400_000);
      const status = isPaid ? "paid" : filedAgo != null ? "pre_petition" : dueAgo > 0 ? "overdue" : "current";
      if (!isPaid) open += inv.amount;
      rows.invoices.push({
        customer_id: id, invoice_number: number, invoice_amount: inv.amount,
        amount_paid: isPaid ? inv.amount : 0, outstanding_amount: isPaid ? 0 : inv.amount, // amount_outstanding is computed by the database
        invoice_date: iso(invoiceDate), due_date: iso(dueDate),
        days_overdue: !isPaid && dueAgo > 0 ? dueAgo : 0, status, currency, claimable: status === "pre_petition",
        escalated_to_collections: false, is_demo: true,
      });
    }

    const limit = round(open / (c.limitUse / 100), 25_000) || 25_000;
    rows.customers.push({
      id, company_name: c.name, scenario: SCENARIO[c.story], lifecycle_status: "active",
      country_code: c.country, city: c.city, headquarters: `${c.city}, ${c.country}`, industry: c.industry, sector: sectorOf(c.industry),
      invoicing_currency: CURRENCY[c.country], payment_terms_days: c.terms,
      credit_limit: limit, current_exposure: open,
      credit_rating_score: c.score, credit_rating_previous_score: c.previousScore ?? null,
      credit_rating_source: "other", credit_rating_updated_at: iso(addDays(t0, c.previousScore != null ? -6 : -40)),
      financials_fye: yearEndFor(t0, c.score),
      customer_since: `${c.sinceYear}-01-01`, company_type: c.invoice >= 200_000 ? "public" : "private",
      policy_group: c.policyGroup ?? null, website: `https://${prefix.toLowerCase()}${c.n}.example.com`,
    });

    // News and filings (read by the news and SEC agents through seed_news / seed_sec_filings).
    const cik = `000999${String(c.n).padStart(4, "0")}`;
    const news = (daysAgo: number, headline: string, summary: string, relevance = 0.92) =>
      rows.seedNews.push({ customer_id: id, company_name: c.name, headline, summary, source: "Demo Newswire", published_date: iso(addDays(t0, -daysAgo)), relevance_score: relevance, provider: "manual" });
    const filing = (daysAgo: number, type: string, flags: string[], summary: string) => {
      rows.seedSecFilings.push({ cik, company_name: c.name, filing_type: type, filing_date: iso(addDays(t0, -daysAgo)), accession_number: `${cik}-DEMO-${c.n}${type.replace(/\W/g, "")}`, document_url: `https://filings.example.com/${cik}/${c.n}-${type.replace(/\W/g, "")}`, risk_signals: flags, key_findings: summary, provider: "sample" });
    };
    if (c.story === "news_shock" && c.limitUse > 80) news(3, `${c.name} loses its largest customer as distributor contract ends`, `${c.name} said its largest customer, about a third of revenue, will not renew a supply contract ending next quarter. The company is reviewing costs and its credit facilities.`);
    if (c.story === "news_shock" && c.limitUse <= 80) news(4, `${c.name} in dispute with key resin supplier`, `${c.name} confirmed a pricing dispute with its main resin supplier that has slowed deliveries to customers this month.`, 0.85);
    if (c.story === "going_concern") {
      filing(9, "10-K", ["going_concern_warning", "cash_runway_<3_quarters"], "Auditor expressed substantial doubt about the company's ability to continue as a going concern; cash runway under three quarters.");
      news(8, `${c.name} auditor flags going-concern doubt`, `${c.name}'s auditor raised substantial doubt about its ability to continue as a going concern in its annual report, citing recurring losses and limited cash.`);
    }
    if (c.story === "covenant_waiver") {
      filing(6, "8-K", ["ceo_departure"], "Chief executive officer stepped down; the chief financial officer serves as interim CEO.");
      filing(20, "10-Q", ["covenant_waiver"], "Company disclosed a covenant waiver under its credit agreement for the quarter.");
    }
    if (c.story === "bankruptcy") news(BANKRUPTCY_FILED_DAYS_AGO, `${c.name} files for Chapter 11 protection`, `${c.name} filed for Chapter 11 bankruptcy protection and said it will keep operating while it restructures. Invoices before the filing are frozen.`, 0.97);
    if (rows.seedSecFilings.some((f) => f.cik === cik)) {
      rows.secMonitoring.push({ customer_id: id, cik, monitoring_active: true, is_demo: true });
    }
  }
  return rows;
}
