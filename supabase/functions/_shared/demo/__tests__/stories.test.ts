import { describe, it, expect } from "vitest";
import { buildDemo, DEMO_CUSTOMERS, demoCustomerId, GRACE_DAYS, BANKRUPTCY_FILED_DAYS_AGO } from "../stories";

const TODAY = new Date("2026-11-22T12:00:00Z");
const days = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);
const demo = buildDemo(TODAY);
const byCustomer = <T extends Record<string, unknown>>(rows: T[]) => {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(r.customer_id as string, [...(m.get(r.customer_id as string) ?? []), r]);
  return m;
};
const inv = byCustomer(demo.invoices);
const pay = byCustomer(demo.payments);
const open = (id: string) => (inv.get(id) ?? []).filter((i) => i.status !== "paid");
const recentLateness = (id: string) => {
  const p = (pay.get(id) ?? []).filter((x) => days("2026-11-22", x.payment_date as string) <= 90);
  return p.length ? p.reduce((s, x) => s + (x.days_early_late as number), 0) / p.length : null;
};

describe("demo portfolio: shape", () => {
  it("has 40 customers, 27 quiet and 13 with a story, all fictional with example.com sites", () => {
    expect(demo.customers).toHaveLength(40);
    expect(DEMO_CUSTOMERS.filter((c) => c.story === "steady")).toHaveLength(27);
    expect(new Set(demo.customers.map((c) => c.company_name)).size).toBe(40);
    for (const c of demo.customers) expect(String(c.website)).toMatch(/\.example\.com$/);
  });
  it("is the same every time for the same day, and moves with the day", () => {
    expect(buildDemo(TODAY)).toEqual(demo);
    const later = buildDemo(new Date("2027-01-21T12:00:00Z"));
    expect(later.invoices.length).toBe(demo.invoices.length);
    expect(days(later.invoices[0].invoice_date as string, demo.invoices[0].invoice_date as string)).toBe(60);
  });
  it("uses only the four countries and their currencies", () => {
    const pairs = new Set(demo.customers.map((c) => `${c.country_code}:${c.invoicing_currency}`));
    expect([...pairs].sort()).toEqual(["DE:EUR", "GB:GBP", "JP:JPY", "US:USD"]);
  });
});

describe("demo portfolio: every page agrees", () => {
  it("due date = invoice date + terms on every invoice and payment", () => {
    const terms = new Map(demo.customers.map((c) => [c.id as string, c.payment_terms_days as number]));
    for (const i of demo.invoices) expect(days(i.due_date as string, i.invoice_date as string)).toBe(terms.get(i.customer_id as string));
    for (const p of demo.payments) expect(days(p.invoice_due_date as string, p.invoice_date as string)).toBe(terms.get(p.customer_id as string));
  });
  it("payment lateness = payment date - due date, and nothing is dated after today", () => {
    for (const p of demo.payments) {
      expect(days(p.payment_date as string, p.invoice_due_date as string)).toBe(p.days_early_late);
      expect(p.on_time).toBe((p.days_early_late as number) <= GRACE_DAYS);
      expect(days(p.payment_date as string, "2026-11-22")).toBeLessThan(0);
    }
    for (const i of demo.invoices) expect(days(i.invoice_date as string, "2026-11-22")).toBeLessThan(0);
  });
  it("exposure = open invoices, and the limit gives the story's limit use (within 5 points)", () => {
    for (const c of demo.customers) {
      const o = open(c.id as string).reduce((s, i) => s + (i.outstanding_amount as number), 0);
      expect(c.current_exposure).toBe(o);
      const story = DEMO_CUSTOMERS.find((d) => demoCustomerId(d.n) === c.id)!;
      expect(Math.abs((o / (c.credit_limit as number)) * 100 - story.limitUse)).toBeLessThan(5);
    }
  });
  it("days overdue = today - due date on open invoices; paid invoices are not overdue", () => {
    for (const i of demo.invoices) {
      if (i.status === "overdue") expect(i.days_overdue).toBe(days("2026-11-22", i.due_date as string));
      if (i.status === "paid" || i.status === "current") expect(i.days_overdue).toBe(0);
    }
  });
  it("a customer paying on time has nothing more than grace days overdue", () => {
    for (const c of DEMO_CUSTOMERS.filter((c) => ["steady", "score_drop", "covenant_waiver", "news_shock"].includes(c.story))) {
      for (const i of open(demoCustomerId(c.n))) expect(i.days_overdue as number).toBeLessThanOrEqual(GRACE_DAYS);
    }
  });
  it("a customer paying 15+ days late has something overdue", () => {
    for (const c of DEMO_CUSTOMERS) {
      const late = recentLateness(demoCustomerId(c.n));
      if (late != null && late >= 15 && c.story !== "bankruptcy") {
        expect(open(demoCustomerId(c.n)).some((i) => i.status === "overdue"), c.name).toBe(true);
      }
    }
  });
});

describe("demo portfolio: the stories", () => {
  const story = (s: string) => DEMO_CUSTOMERS.filter((c) => c.story === s).map((c) => demoCustomerId(c.n));
  it("steady payers are on time at least 85% of the time", () => {
    for (const id of story("steady")) {
      const p = pay.get(id)!;
      expect(p.filter((x) => x.on_time).length / p.length).toBeGreaterThanOrEqual(0.85);
    }
  });
  it("slowing payers are on time early on and late now", () => {
    for (const id of story("slowing")) {
      const p = pay.get(id)!;
      expect(p[0].on_time).toBe(true);
      expect(recentLateness(id)!).toBeGreaterThan(10);
    }
  });
  it("the over-limit customer with a weak score has an invoice 60+ days overdue", () => {
    const weak = DEMO_CUSTOMERS.find((c) => c.story === "over_limit" && c.score < 50)!;
    expect(Math.max(...open(demoCustomerId(weak.n)).map((i) => i.days_overdue as number))).toBeGreaterThanOrEqual(60);
  });
  it("the bankrupt customer has only frozen invoices from before the filing and no payment since", () => {
    const [id] = story("bankruptcy");
    for (const i of open(id)) {
      expect(i.status).toBe("pre_petition");
      expect(days("2026-11-22", i.invoice_date as string)).toBeGreaterThan(BANKRUPTCY_FILED_DAYS_AGO);
    }
    for (const p of pay.get(id)!) expect(days("2026-11-22", p.payment_date as string)).toBeGreaterThan(BANKRUPTCY_FILED_DAYS_AGO);
    expect(demo.seedNews.some((n) => n.customer_id === id && /Chapter 11/.test(n.headline as string))).toBe(true);
  });
  it("the improving customer was late before and is on time for the last 3 months", () => {
    const [id] = story("improving");
    expect(recentLateness(id)!).toBeLessThanOrEqual(GRACE_DAYS);
    expect(pay.get(id)!.slice(0, 3).every((x) => !x.on_time)).toBe(true);
  });
  it("news and filings exist only for the stories that have them, dated in the last 3 weeks", () => {
    const withNews = new Set(demo.seedNews.map((n) => n.customer_id));
    const withFilings = new Set(demo.secMonitoring.map((m) => m.customer_id));
    expect(withNews).toEqual(new Set([...story("news_shock"), ...story("going_concern"), ...story("bankruptcy")]));
    expect(withFilings).toEqual(new Set([...story("going_concern"), ...story("covenant_waiver")]));
    for (const x of [...demo.seedNews.map((n) => n.published_date), ...demo.seedSecFilings.map((f) => f.filing_date)]) {
      expect(days("2026-11-22", x as string)).toBeLessThanOrEqual(21);
    }
  });
  it("only the score stories carry a previous score", () => {
    const withPrev = DEMO_CUSTOMERS.filter((c) => c.previousScore != null).map((c) => c.story).sort();
    expect(withPrev).toEqual(["bankruptcy", "going_concern", "improving", "score_drop"]);
  });
});

describe("demo portfolio: fits the database", () => {
  const SECTORS = ["Aerospace & Defense", "Energy", "Industrial Manufacturing", "Materials", "Transportation", "Mining", "Other"];
  const SCENARIOS = ["normal_operations", "payment_issues", "credit_deterioration", "negative_news", "growth_opportunity", "bankruptcy", "sec_filing_monitoring"];
  it("uses only the database's sectors, scenarios and invoice statuses", () => {
    for (const c of demo.customers) { expect(SECTORS).toContain(c.sector); expect(SCENARIOS).toContain(c.scenario); }
    for (const i of demo.invoices) expect(["current", "overdue", "pre_petition", "paid"]).toContain(i.status);
  });
  it("never writes the computed column amount_outstanding, and fills every required column", () => {
    for (const i of demo.invoices) expect(i).not.toHaveProperty("amount_outstanding");
    for (const f of demo.seedSecFilings) expect(f.document_url).toBeTruthy();
    for (const c of demo.customers) for (const k of ["company_name", "scenario", "credit_limit", "current_exposure", "payment_terms_days", "sector", "country_code"]) expect(c[k]).not.toBeNull();
  });
});
