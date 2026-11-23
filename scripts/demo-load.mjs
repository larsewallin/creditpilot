#!/usr/bin/env -S node --experimental-strip-types
/**
 * Writes the demo portfolio (supabase/functions/_shared/demo/stories.ts) for today into a
 * database, through the API with the service role key. Inserts only: the caller clears the old
 * demo rows first (the Fresh install workflow truncates its throwaway database).
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node --experimental-strip-types scripts/demo-load.mjs
 *
 * Never point it at production by hand: the live demo switches over in its own reviewed step.
 */
import { createClient } from "@supabase/supabase-js";
import { buildDemo } from "../supabase/functions/_shared/demo/stories.ts";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required"); process.exit(2); }
if (/yxqudytimmxufypothis/.test(url) && process.env.DEMO_LOAD_PRODUCTION !== "yes") {
  console.error("Refusing to load into production: the live demo switches over in its own reviewed step.");
  process.exit(2);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const rows = buildDemo(new Date());

async function insert(table, data, chunk = 500) {
  for (let i = 0; i < data.length; i += chunk) {
    const { error } = await db.from(table).insert(data.slice(i, i + chunk));
    if (error) { console.error(`${table}: ${error.message}`); process.exit(1); }
  }
  console.log(`${table.padEnd(22)} ${data.length}`);
}

await insert("customers", rows.customers);
await insert("invoices", rows.invoices);
await insert("payment_transactions", rows.payments);
await insert("seed_news", rows.seedNews);
await insert("seed_sec_filings", rows.seedSecFilings);
await insert("sec_monitoring", rows.secMonitoring);
