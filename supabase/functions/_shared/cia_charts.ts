/**
 * Small charts under a CIA answer (CIA v2, 2026-11-19). Every number is computed here from the
 * rows already read for the answer, never by the model (CLAUDE.md: no LLM arithmetic over
 * several records). At most two charts, chosen by what the question is about.
 */

export interface ChartRow { label: string; value: number; tone?: "bad" | "good" | "neutral"; display?: string }
export interface Chart {
  title: string;
  unit: "usd" | "days" | "pct";
  rows: ChartRow[];
  note?: string;
}

interface Inputs {
  question: string;
  companyMentions: string[];
  customers?: any[];
  payment_trend?: any[] | null;
  payment_trend_named?: any[] | null;
  ar_aging_customer_summary?: any[] | null;
  ar_aging_portfolio_summary?: any | null;
  country_totals?: { country: string; customers: number; exposure: number; limit: number }[] | null;
  currency_totals?: { currency: string; invoices: number; usd: number; local: number }[] | null;
}

const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const round1 = (v: number) => Math.round(v * 10) / 10;
const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

function agingRows(s: any, keys: { current: string; b1: string; b2: string; b3: string; b4: string }): ChartRow[] {
  const rows: ChartRow[] = [
    { label: "Current", value: num(s[keys.current]) ?? 0, tone: "good" },
    { label: "1–30 days", value: num(s[keys.b1]) ?? 0, tone: "neutral" },
    { label: "31–60 days", value: num(s[keys.b2]) ?? 0, tone: "bad" },
    { label: "61–90 days", value: num(s[keys.b3]) ?? 0, tone: "bad" },
    { label: "90+ days", value: num(s[keys.b4]) ?? 0, tone: "bad" },
  ];
  return rows.map((r) => ({ ...r, display: usd(r.value) }));
}

export function buildCharts(i: Inputs): Chart[] {
  const q = i.question.toLowerCase();
  const charts: Chart[] = [];
  const add = (c: Chart | null) => { if (c && c.rows.length && c.rows.some((r) => r.value !== 0) && charts.length < 2) charts.push(c); };

  const asksPay = /\b(pay|pays|paid|paying|payments?|late|on.?time|days)\b/.test(q);
  const asksAging = /\b(aging|ageing|overdue|past due|outstanding|ar\b|receivable)/.test(q);
  const asksCountry = /\b(countr|geograph|region)/.test(q);
  const asksFx = /\b(fx|currenc|exchange rate)/.test(q);

  // One named customer: its payment trend, aging and limit use.
  const named = (i.payment_trend_named ?? []).filter((r) => r && r.company_name);
  if (i.companyMentions.length >= 1 && i.companyMentions.length <= 2) {
    for (const r of named.slice(0, 1)) {
      const before = num(r.prior_avg_days_late), now = num(r.current_avg_days_late);
      if (before != null && now != null && (asksPay || !asksAging)) {
        add({
          title: `${r.company_name}: average days late`,
          unit: "days",
          rows: [
            { label: "90 days before", value: before, display: `${round1(before)} days`, tone: "neutral" },
            { label: "Last 90 days", value: now, display: `${round1(now)} days`, tone: now > before + 3 ? "bad" : now < before - 3 ? "good" : "neutral" },
          ],
          note: r.payment_terms_days ? `Terms net ${r.payment_terms_days}` : undefined,
        });
      }
    }
    const aging = (i.ar_aging_customer_summary ?? [])[0];
    if (aging && (asksAging || charts.length === 0)) {
      add({
        title: `${aging.company_name}: open invoices by age`,
        unit: "usd",
        rows: agingRows(aging, { current: "current_amount", b1: "bucket_1_30", b2: "bucket_31_60", b3: "bucket_61_90", b4: "bucket_over_90" }),
      });
    }
    const c = (i.customers ?? []).find((x) => i.companyMentions.some((m) => String(x.company_name ?? "").toLowerCase().includes(m.toLowerCase())));
    const bal = num(c?.current_exposure), lim = num(c?.credit_limit);
    if (c && bal != null && lim && lim > 0) {
      const pct = (bal / lim) * 100;
      add({
        title: `${c.company_name}: credit limit used`,
        unit: "usd",
        rows: [
          { label: "Balance", value: bal, display: `${usd(bal)} (${Math.round(pct)}%)`, tone: pct >= 90 ? "bad" : pct >= 75 ? "neutral" : "good" },
          { label: "Credit limit", value: lim, display: usd(lim), tone: "neutral" },
        ],
      });
    }
    return charts;
  }

  // Portfolio questions.
  if (asksPay && /\b(worse|later|slow|deteriorat|improv|earlier|better)\b/.test(q) && i.payment_trend?.length) {
    const improving = /\b(improv|earlier|better)\b/.test(q);
    const rows = i.payment_trend
      .filter((r) => (improving ? r.improvement_severity : r.deterioration_severity) && num(r.delta_days_late) != null)
      .sort((a, b) => (improving ? -1 : 1) * (Number(b.delta_days_late) - Number(a.delta_days_late)))
      .slice(0, 8)
      .map((r) => {
        const d = Number(r.delta_days_late);
        return { label: String(r.company_name), value: Math.abs(d), display: `${d > 0 ? "+" : ""}${round1(d)} days`, tone: (d > 0 ? "bad" : "good") as ChartRow["tone"] };
      });
    add({ title: improving ? "Paying earlier: change in average days late" : "Paying later: change in average days late", unit: "days", rows, note: "Last 90 days against the 90 days before" });
  }
  if (asksAging && i.ar_aging_portfolio_summary) {
    add({
      title: "Open invoices by age (portfolio)",
      unit: "usd",
      rows: agingRows(i.ar_aging_portfolio_summary, { current: "total_current", b1: "total_1_30", b2: "total_31_60", b3: "total_61_90", b4: "total_over_90" }),
    });
  }
  if (asksCountry && i.country_totals?.length) {
    add({
      title: "Balance by country",
      unit: "usd",
      rows: [...i.country_totals].sort((a, b) => b.exposure - a.exposure).slice(0, 8)
        .map((c) => ({ label: c.country, value: c.exposure, display: `${usd(c.exposure)} · ${c.customers} customer${c.customers === 1 ? "" : "s"}`, tone: "neutral" as const })),
    });
  }
  if (asksFx && i.currency_totals?.length) {
    add({
      title: "Open receivables by currency (USD)",
      unit: "usd",
      rows: [...i.currency_totals].sort((a, b) => b.usd - a.usd).slice(0, 8)
        .map((c) => ({ label: c.currency, value: c.usd, display: `${usd(c.usd)} · ${c.invoices} invoice${c.invoices === 1 ? "" : "s"}`, tone: "neutral" as const })),
    });
  }
  return charts;
}
