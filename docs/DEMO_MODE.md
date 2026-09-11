# Demo Mode

CreditPilot ships with a full demo dataset: a fictional specialty alloys distributor with 59 customers across seven credit scenarios. Demo mode lets you explore the full UI against realistic data without touching real customer records.

A live demo is available at [creditpilot.vercel.app](https://creditpilot.vercel.app) — no signup required.

---

## How it works

Demo mode is controlled by a single flag in two places:

- **Frontend:** `import.meta.env.VITE_DEMO_MODE` — when `true`, the app calls `lib/initDemo.ts` on first page load (guarded by `sessionStorage`).
- **Edge functions:** each agent reads `Deno.env.get("DEMO_MODE") === "true"`.

The demo dataset is **not** loaded by the migrations — it lives in `supabase/seed.sql` and is loaded separately (see [Loading the demo data](#loading-the-demo-data)). A production deployment simply never loads it.

### The core principle: demo runs the real pipeline

The three monitoring agents (AR Aging, News, SEC) run the **identical pipeline** in demo and production. `DEMO_MODE` switches only at the **data-fetch point** — demo reads from a seed table, production hits the live source — and everything downstream (processing, `publishEvent` emission, notification) is shared.

| Agent / mode | Demo data source | Calls Claude API? |
|---|---|---|
| ar-aging-agent | AR snapshots / invoices (seeded) | No |
| news-monitor-agent | `seed_news` via `searchSeedNews()` | No |
| sec-monitor-agent | `seed_sec_filings` via `fetchSeedSecFilings()` | No |
| cia-agent — briefing | canned `DEMO_BRIEFING` (fast-path) | No |
| cia-agent — suggestions | canned `DEMO_SUGGESTIONS` | No |
| cia-agent — question | live `credit_events` (real Q&A) | **Yes** |

For the monitors, `DEMO_MODE` is a `seed ? live` ternary at the fetch call; the seed-fetch functions (`searchSeedNews`, `fetchSeedSecFilings`) run the same classify → `publishEvent` → notify pipeline as production, deterministically.

### CIA is a special case

The CIA (Credit Intelligence Agent) is a Q&A agent, not a monitor, and behaves differently by mode:

- **Briefing** (default) and **suggestions** take a demo fast-path that returns pre-composed content — no API call, instant.
- **Question mode** always calls the Claude API, in demo *and* production, reading real `credit_events` from the database. Demo uses a cheaper model (`claude-haiku-4-5`, 600 tokens) vs production (`claude-sonnet`, 900 tokens). This means CIA Q&A works in demo but requires `ANTHROPIC_API_KEY`.

### Demo repeatability (state reset)

Each monitoring agent, when `DEMO_MODE=true`, clears its own prior demo output at the start of a run (its `is_demo` `credit_events` plus its pipeline-generated working rows) so re-runs regenerate cleanly rather than dedup-skipping. This is gated on `DEMO_MODE` — production never self-deletes.

### Data isolation

Demo-generated rows carry `is_demo = true`. This column exists on: `credit_events`, `agent_messages`, `pending_actions`, `invoices`, `payment_transactions`, `negative_news`, `sec_filings`, and `sec_monitoring`. (Note: `customers` and `ar_aging_snapshots` are not tagged — the seed dataset and a production dataset are kept separate by loading, not by per-row flag.)

---

## Loading the demo data

```bash
psql "$DATABASE_URL" -f supabase/seed.sql
```

Skip this for a production deployment. Real data enters via the AR aging CSV upload; the demo seed and production data are mutually exclusive.

---

## Reset Demo

The **Reset Demo** button on the Actions page calls `initDemo()` (`src/lib/initDemo.ts`). It:

1. Resets demo row **state** — `pending_actions` back to `pending`, `agent_messages` to `pending`, `credit_events.cia_processed` cleared, `sec_monitoring`/`negative_news` review flags reset, and seed credit limits restored.
2. Re-invokes all four agents, which regenerate their outputs.

It does **not** recreate the underlying seed rows (customers, invoices, etc.) — those are loaded once via `supabase/seed.sql` and persist. Reset relies on them already being present.

---

## Seed data overview

| Table | Rows | Description |
|-------|------|-------------|
| `customers` | 59 | Fictional specialty alloys customers across 7 scenarios |
| `credit_events` | 48 | Pre-seeded signals |
| `agent_messages` | ~30 | Alerts and composed messages |
| `pending_actions` | 5 | Credit limit reductions awaiting approval |
| `negative_news` | 5 | Pipeline-generated news items |
| `sec_monitoring` | 3 | Companies with SEC monitoring |
| `sec_filings` | 8 | Seeded filings |
| `seed_news` | 5 | Demo-mode news source rows |
| `seed_sec_filings` | 2 | Demo-mode SEC source rows |

---

## Moving to production

1. Set `VITE_DEMO_MODE=false` in your frontend `.env`.
2. Set `DEMO_MODE=false` (or remove it) in Supabase Edge Function secrets.
3. Don't load `supabase/seed.sql` (or start from a fresh project). Load real data via the AR aging CSV upload.
4. Harden RLS policies — remove anon write access from `pending_actions`, `customers`, and `credit_events`.
5. Add Supabase Auth so users must sign in.

See [docs/DEPLOYMENT.md](DEPLOYMENT.md) for full deployment instructions.
