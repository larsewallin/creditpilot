// Rebuilds the demo from the story table (stories.ts) for today: Reset Demo and the daily refresh
// (demo-actions reset). Nothing is rolled forward: every demo row is deleted and written again,
// so payments, invoices, aging, news and filings always agree and the demo looks the same in two
// months. Demo projects only (the caller checks DEMO_MODE).
//
// Order matters: credit_events is the one table that does not go with its customer, so the demo's
// events go first; then every customer not in the story table (the old demo portfolio, and anything
// added in the demo since) with all its rows (they cascade); then the story customers' own rows.

import { buildDemo, demoCustomerId, DEMO_CUSTOMERS } from "./stories.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

const STORY_IDS = DEMO_CUSTOMERS.map((c) => demoCustomerId(c.n));
const STORY_FILTER = `(${STORY_IDS.join(",")})`;

/** Tables holding a story customer's rows, cleared before they are written again. */
const CUSTOMER_TABLES = [
  "payment_transactions", "invoices", "ar_aging_snapshots", "negative_news", "sec_filings", "sec_monitoring",
  "seed_news", "agent_messages", "credit_actions", "pending_actions", "credit_metric_changes", "credit_metrics",
  "growth_signals", "customer_identifiers",
];

export interface RebuildResult { customers: number; invoices: number; payments: number; removedCustomers: number }

export async function rebuildDemo(db: Db, today = new Date()): Promise<RebuildResult> {
  const rows = buildDemo(today);
  const must = async (label: string, p: Promise<{ error: { message: string } | null }>) => {
    const { error } = await p;
    if (error) throw new Error(`rebuildDemo: ${label}: ${error.message}`);
  };

  // 1. Events: the agents write them again after the rebuild.
  await must("demo events", db.from("credit_events").delete().eq("is_demo", true));

  // 2. Customers outside the story table, with their events and (by cascade) everything else.
  const { data: others, error: othersError } = await db.from("customers").select("id").not("id", "in", STORY_FILTER);
  if (othersError) throw new Error(`rebuildDemo: customers: ${othersError.message}`);
  const otherIds: string[] = (others ?? []).map((c: { id: string }) => c.id);
  for (let i = 0; i < otherIds.length; i += 100) {
    const chunk = otherIds.slice(i, i + 100);
    await must("other customers' events", db.from("credit_events").delete().in("customer_id", chunk));
    await must("other customers", db.from("customers").delete().in("id", chunk));
  }

  // 3. The story customers' rows, and the demo-only sample tables.
  for (const table of CUSTOMER_TABLES) await must(table, db.from(table).delete().in("customer_id", STORY_IDS));
  await must("seed_sec_filings", db.from("seed_sec_filings").delete().not("id", "is", null));
  await must("seed_industry_econ_signals", db.from("seed_industry_econ_signals").delete().not("id", "is", null));
  await must("seed_industry_news", db.from("seed_industry_news").delete().not("id", "is", null));

  // 4. Write today's rows, and the day they describe: the pages age invoices against it
  // (private.app_today()), not against the database's UTC date (review 2026-11-23).
  const asOf = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())).toISOString().slice(0, 10);
  await must("demo as-of date", db.from("instance_settings").update({ demo_as_of: asOf }).eq("id", true));
  await must("customers", db.from("customers").upsert(rows.customers, { onConflict: "id" }));
  for (const [table, data] of [
    ["invoices", rows.invoices], ["payment_transactions", rows.payments], ["seed_news", rows.seedNews],
    ["seed_sec_filings", rows.seedSecFilings], ["sec_monitoring", rows.secMonitoring],
    ["seed_industry_econ_signals", rows.industryEcon], ["seed_industry_news", rows.industryNews],
  ] as const) {
    for (let i = 0; i < data.length; i += 500) await must(table, db.from(table).insert(data.slice(i, i + 500)));
  }
  for (const u of rows.countryUpdates) {
    await must(`seed_country_risk ${u.country_code}`, db.from("seed_country_risk").update(u.values).eq("country_code", u.country_code));
  }

  return { customers: rows.customers.length, invoices: rows.invoices.length, payments: rows.payments.length, removedCustomers: otherIds.length };
}
