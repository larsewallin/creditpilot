#!/usr/bin/env -S node --experimental-strip-types
/**
 * Story check: after the agents have run on the demo portfolio, every customer must show exactly
 * its story (stories.ts `expect`): the expected open events, no others, and the expected limit
 * proposal. Quiet customers raise nothing. Prints one line per customer and the page totals.
 * Read-only; never calls the assistant.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node --experimental-strip-types scripts/demo-story-check.mjs [--no-assistant]
 *
 * --no-assistant (CI, no Anthropic key): news is read by the assistant, so news events and the
 * proposals that depend on them are reported as not checked instead of failing.
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

// The CIA's own multi-signal view is allowed wherever the story expects a proposal or two or more
// warnings (a customer to watch: several warning signs, no cut yet).
const NO_ASSISTANT = process.argv.includes("--no-assistant");
const GOOD_NEWS = new Set(["PAYMENT_IMPROVEMENT", "CREDIT_RATING_UPGRADE"]);
const CIA_TYPES = new Set(["COMPOSITE_RISK_CRITICAL", "COMPOSITE_RISK_ELEVATED"]);
const exposure = new Map(customers.map((c) => [c.id, Number(c.current_exposure)]));
const problems = [];
const line = [];

for (const c of DEMO_CUSTOMERS) {
  const id = demoCustomerId(c.n);
  const mine = events.filter((e) => e.customer_id === id);
  const types = [...new Set(mine.map((e) => e.event_type))];
  const notChecked = NO_ASSISTANT ? c.expect.events.filter((t) => t === "NEWS_EVENT" && !types.includes(t)) : [];
  const missing = c.expect.events.filter((t) => !types.includes(t) && !notChecked.includes(t));
  const extra = types.filter((t) => !c.expect.events.includes(t) && !(CIA_TYPES.has(t) && (c.expect.proposal !== "none" || c.expect.events.filter((x) => !GOOD_NEWS.has(x)).length >= 2)));
  const props = actions.filter((a) => a.customer_id === id);
  const p = props[0];
  const cut = p ? 1 - Number(p.proposed_value) / Number(p.current_value) : 0;
  let proposalOk;
  const proposalSkipped = NO_ASSISTANT && c.expect.proposalNeedsNews;
  switch (c.expect.proposal) {
    case "none": proposalOk = props.length === 0; break;
    case "hold": proposalOk = !!p && Number(p.proposed_value) === 0; break;
    case "cut_to_owed": proposalOk = !!p && Math.abs(Number(p.proposed_value) - exposure.get(id)) <= 0.05 * exposure.get(id); break;
    case "cut": proposalOk = !!p && cut >= 0.1 && cut <= 0.5; break;
    case "cut_small": proposalOk = !!p && cut > 0 && cut <= 0.2; break;
  }
  const got = p ? `${Math.round(Number(p.current_value) / 1e3)}k → ${Math.round(Number(p.proposed_value) / 1e3)}k (${Math.round(cut * 100)}%)` : "none";
  if (proposalSkipped) proposalOk = true;
  const ok = !missing.length && !extra.length && proposalOk && props.length <= 1;
  if (!ok) problems.push(c.name);
  line.push(`${ok ? "ok  " : "FAIL"} ${String(c.n).padStart(2)} ${c.name.padEnd(32)} ${c.story.padEnd(17)} events [${types.join(", ")}]` +
    `${missing.length ? ` missing [${missing.join(", ")}]` : ""}${extra.length ? ` unexpected [${extra.join(", ")}]` : ""}` +
    `${notChecked.length ? " (news not checked without the assistant)" : ""}` +
    ` | proposal ${got}${proposalSkipped ? " (needs news: not checked)" : proposalOk ? "" : ` (expected ${c.expect.proposal})`}${props.length > 1 ? ` (${props.length} proposals)` : ""}`);
}

const portfolio = events.filter((e) => !e.customer_id);
const bySeverity = events.reduce((m, e) => ({ ...m, [e.severity]: (m[e.severity] ?? 0) + 1 }), {});
console.log(line.join("\n"));
console.log(`\nPortfolio events (${portfolio.length}):`);
for (const e of portfolio) console.log(`  ${e.severity.padEnd(8)} ${e.event_type.padEnd(26)} ${e.title}`);
const customerEvents = events.length - portfolio.length;
console.log(`\nOpen events: ${events.length}: ${customerEvents} on customers, ${portfolio.length} portfolio ${JSON.stringify(bySeverity)}. Pending proposals: ${actions.length} (target about 6).`);
// Plan: about 25–30 open events, a handful of them portfolio-wide (one industry, one country,
// currency moves).
if (customerEvents > 35) problems.push(`customer events ${customerEvents} (target under 30)`);
if (portfolio.length > 8) problems.push(`portfolio events ${portfolio.length} (target about 5)`);
if (problems.length) { console.log(`\n${problems.length} problem(s): ${problems.join("; ")}`); process.exit(1); }
console.log("\nEvery story shows exactly what it should.");
