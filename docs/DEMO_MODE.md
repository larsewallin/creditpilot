# Demo Mode

CreditPilot ships with a full demo dataset: a fictional $500M specialty alloys distributor with 59 customers across seven credit scenarios. Demo mode lets you explore the full UI without an Anthropic API key and without touching real customer data.

A live demo is available at [creditpilot.vercel.app](https://creditpilot.vercel.app) — no signup required.

---

## How it works

### Frontend flag

The React app reads `import.meta.env.VITE_DEMO_MODE`. When `true`, `lib/initDemo.ts` is called on first page load (guarded by `sessionStorage.getItem("demo_initialized")`).

`initDemo` invokes all four agents in sequence:

```
ar-aging-agent → news-monitor-agent → sec-monitor-agent → cia-agent (briefing)
```

Each agent detects `DEMO_MODE=true` from its environment and returns pre-seeded data without making API calls.

### Edge function flag

Each agent reads `Deno.env.get("DEMO_MODE") === "true"`. When true, the agent:

1. Skips the rate limit check.
2. Inserts a pre-baked `agent_runs` record with fixed statistics.
3. Returns the seed run ID immediately.

No `credit_events`, `agent_messages`, or `pending_actions` are created by the monitoring agents in demo mode — these rows already exist in the seed data.

The exception is **CIA `question` mode**: even in demo mode, question mode calls the Anthropic API against real `credit_events` from the database. This means CIA Q&A works in demo mode but requires `ANTHROPIC_API_KEY`.

### Data isolation

All demo rows carry `is_demo = true`. This column exists on:

- `credit_events`
- `agent_messages`
- `pending_actions`
- `negative_news` (added in migration `20260426000000_news_agent_foundation`; all pre-existing seed rows tagged `is_demo = true`)

Demo and production data never mix because queries can filter by `is_demo`.

---

## Reset Demo

The **Reset Demo** button in the Actions page calls `initDemo()` directly. It:

1. Invokes all four agents (which replay their seed run records).
2. Calls `queryClient.invalidateQueries()` to refresh the UI.

The AR Aging Agent's demo path also resets any approved or rejected `pending_actions` back to `pending` status, so the approval workflow can be demonstrated again.

---

## Seed data overview

| Table | Rows | Description |
|-------|------|-------------|
| `customers` | 59 | Fictional specialty alloys customers across 7 credit scenarios |
| `credit_events` | ~80 | Pre-seeded signals from all three monitoring agents |
| `agent_messages` | ~15 | Dunning letters, Teams alerts, SEC email alerts |
| `pending_actions` | 3 | Credit limit reductions awaiting approval |
| `negative_news` | 28 | Pre-classified news items |
| `sec_monitoring` | 3 | Companies with active SEC alerts |

---

## Moving to production

To switch from demo to production data:

1. Set `VITE_DEMO_MODE=false` in your frontend `.env`.
2. Set `DEMO_MODE=false` (or remove it) in Supabase Edge Function secrets.
3. Load real customer data into the `customers`, `ar_aging`, `payment_transactions`, `negative_news`, and `sec_monitoring` tables.
4. Harden RLS policies — remove anon write access from `pending_actions`, `customers`, and `credit_events`.
5. Add Supabase Auth so users must sign in.

See [docs/DEPLOYMENT.md](DEPLOYMENT.md) for full deployment instructions.
