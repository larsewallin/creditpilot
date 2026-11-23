#!/usr/bin/env -S node --experimental-strip-types
/**
 * Story check: after the agents have run on the demo portfolio, every customer must show exactly
 * its story (stories.ts `expect`): the expected open events, no others, and the expected limit
 * proposal. Quiet customers raise nothing. Prints one line per customer and the page totals.
 * Read-only; never calls the assistant.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node --experimental-strip-types scripts/demo-story-check.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { DEMO_CUSTOMERS, demoCustomerId } from "../supabase/functions/_shared/demo/stories.ts";

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const [{ data: events, error: e1 }, { data: actions, error: e2 }, { data: customers, error: e3 }] = await Promise.all([
  db.from("credit_events").select("customer_id, scope, event_type, severity, source_agent, title").eq("is_demo", true).is("archived_at", null),
  db.from("pending_actions").select("customer_id, action_type, current_value, proposed_value, rationale").eq("is_demo", true).eq("status", "pending"),
  db.from("customers").select("id, current_exposure, credit_limit"),
]);
if (e1 || e2 || e3) { console.error(e1?.message ?? e2?.message ?? e3?.message); process.exit(1); }

// Events the CIA adds on top of the agents' (its own multi-signal view) are allowed wherever a
// proposal is expected.
const CIA_TYPES = new Set(["COMPOSITE_RISK_CRITICAL", "COMPOSITE_RISK_ELEVATED"]);
const exposure = new Map(customers.map((c) => [c.id, Number(c.current_exposure)]));
const problems = [];
const line = [];

for (const c of DEMO_CUSTOMERS) {
  const id = demoCustomerId(c.n);
  const mine = events.filter((e) => e.customer_id === id);
  const types = [...new Set(mine.map((e) => e.event_type))];
  const missing = c.expect.events.filter((t) => !types.includes(t));
  const extra = types.filter((t) => !c.expect.events.includes(t) && !(CIA_TYPES.has(t) && c.expect.proposal !== "none"));
  const props = actions.filter((a) => a.customer_id === id);
  const p = props[0];
  const cut = p ? 1 - Number(p.proposed_value) / Number(p.current_value) : 0;
  let proposalOk;
  switch (c.expect.proposal) {
    case "none": proposalOk = props.length === 0; break;
    case "hold": proposalOk = !!p && Number(p.proposed_value) === 0; break;
    case "cut_to_owed": proposalOk = !!p && Math.abs(Number(p.proposed_value) - exposure.get(id)) <= 0.05 * exposure.get(id); break;
    case "cut": proposalOk = !!p && cut >= 0.1 && cut <= 0.5; break;
    case "cut_small": proposalOk = !!p && cut > 0 && cut <= 0.2; break;
  }
  const got = p ? `${Math.round(Number(p.current_value) / 1e3)}k → ${Math.round(Number(p.proposed_value) / 1e3)}k (${Math.round(cut * 100)}%)` : "none";
  const ok = !missing.length && !extra.length && proposalOk && props.length <= 1;
  if (!ok) problems.push(c.name);
  line.push(`${ok ? "ok  " : "FAIL"} ${String(c.n).padStart(2)} ${c.name.padEnd(32)} ${c.story.padEnd(17)} events [${types.join(", ")}]` +
    `${missing.length ? ` missing [${missing.join(", ")}]` : ""}${extra.length ? ` unexpected [${extra.join(", ")}]` : ""}` +
    ` | proposal ${got}${proposalOk ? "" : ` (expected ${c.expect.proposal})`}${props.length > 1 ? ` (${props.length} proposals)` : ""}`);
}

const portfolio = events.filter((e) => !e.customer_id);
const bySeverity = events.reduce((m, e) => ({ ...m, [e.severity]: (m[e.severity] ?? 0) + 1 }), {});
console.log(line.join("\n"));
console.log(`\nPortfolio events (${portfolio.length}):`);
for (const e of portfolio) console.log(`  ${e.severity.padEnd(8)} ${e.event_type.padEnd(26)} ${e.title}`);
console.log(`\nOpen events: ${events.length} (target 25–30) ${JSON.stringify(bySeverity)}. Pending proposals: ${actions.length} (target about 6).`);
if (events.length > 40 || events.length < 15) problems.push(`open events ${events.length}`);
if (problems.length) { console.log(`\n${problems.length} problem(s): ${problems.join("; ")}`); process.exit(1); }
console.log("\nEvery story shows exactly what it should.");
