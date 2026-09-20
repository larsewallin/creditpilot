# Architecture

## System overview

```
Browser (React / Vite)
    │
    │  PostgREST (direct table queries)
    ▼
Supabase Postgres ◄──────────────────────────────┐
    │                                             │
    │  supabase.functions.invoke(...)             │ writes
    ▼                                             │
Supabase Edge Functions (Deno)                      │
    ├── ar-aging-agent     (no external API calls)  │
    ├── news-monitor-agent ──► Tavily + Claude API   │
    ├── sec-monitor-agent  ──► SEC EDGAR API         │
    ├── cia-agent          ──► Anthropic Claude API  │
    └── ar-csv-upload      (CSV ingestion endpoint)  ┘
```

There is no separate API server. The React frontend queries Postgres directly via the Supabase client (PostgREST). Agents are invoked by the frontend via `supabase.functions.invoke` and write their results to shared Postgres tables.

---

## Frontend

Built with React 18, Vite, TypeScript, Tailwind CSS, and shadcn/ui. Routing is React Router v6. Data fetching uses TanStack Query (React Query).

The frontend is deployed to Vercel. It reads three environment variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (Supabase connection) and `VITE_DEMO_MODE` (read directly in `lib/constants.ts`).

### Key pages

| Route | File | Purpose |
|-------|------|---------|
| `/events` | `CreditEvents.tsx` | Central signal log — default landing page |
| `/actions` | `Actions.tsx` | Pending action queue (from `pending_actions`); approve writes an audit row to `credit_actions` — reject only updates `pending_actions.status`, no `credit_actions` row |
| `/aging` | `ArAging.tsx` | AR aging dashboard |
| `/news` | `NewsMonitor.tsx` | Negative news alert feed |
| `/sec` | `SecFilings.tsx` | SEC filing monitoring with EDGAR links |
| `/customers` | `Customers.tsx` | Customer directory with credit metrics |
| `/cia` | `CIA.tsx` | Perplexity-style CIA answer page |

### Key components

- **`AppSidebar.tsx`** — Navigation sidebar with live agent run status badges
- **`CIAChat.tsx`** — Fixed bottom bar; fetches AI-generated question suggestions; navigates to `/cia?q=...` on submit
- **`AgentPill.tsx`** — Coloured pill showing which agent produced an event
- **`SeverityBadge.tsx`** — Critical / high / medium / low indicator

### Key utilities

- **`lib/initDemo.ts`** — Demo reset logic; invoked on first page load and by the Reset Demo button
- **`lib/constants.ts`** — `DEMO_MODE` flag derived from `import.meta.env.VITE_DEMO_MODE`

---

## Edge functions

There are 5 Supabase Edge Functions written in TypeScript/Deno, but they do not all share one common pattern — confirmed directly against each function's code, not assumed from the fact that 3 of them look similar. Described separately below rather than as one false "all agents" generalization.

### The 3 monitoring agents (ar-aging-agent, news-monitor-agent, sec-monitor-agent)

These three genuinely share the same pattern, confirmed line-for-line in each:

1. **OPTIONS preflight** — return CORS headers immediately.
2. **Rate limit** — reject requests if a completed/running run exists within the past 60 minutes (HTTP 429). `RATE_LIMIT_MINUTES = 60` in all three.
3. **DEMO_MODE self-reset** — if `Deno.env.get("DEMO_MODE") === "true"`, the agent first clears its own prior demo-tagged output (credit_events + its working table, e.g. negative_news/sec_filings) so re-running the demo regenerates a clean, repeatable result instead of stacking duplicates or silently deduping to nothing. Production never self-deletes.
4. **Insert `agent_runs` row** — status `running`.
5. **Fetch source data** — at this single point, these agents branch `DEMO_MODE ? seed table : live source` (news/SEC only — AR aging has no seed/live split since its data source, invoices, is internal to the system either way).
6. **Process and emit** — every downstream step (classification, risk detection, severity scoring) is identical in demo and production. Events are written via `publishEvent` (validated payloads, severity reconciliation, correlation_id) — this is the only path allowed to write to `credit_events`. Every inserted row is stamped `is_demo: DEMO_MODE`.
7. **Update `agent_runs`** — status `completed` or `failed`.

**Important:** demo mode is not a bypass. All three run their real detection/classification/emission logic against seed data in demo — no pre-baked run logs, no skipped API calls (except the deliberate `DEMO_MODE`-gated cost controls noted per-agent in `docs/AGENTS.md`, e.g. News agent skipping live Tavily calls in favor of seed articles).

### cia-agent — does not follow the pattern above

Confirmed directly: `cia-agent` has no `RATE_LIMIT_MINUTES`/HTTP 429 gate anywhere in its code, and no DEMO_MODE self-reset delete logic. Its `agent_runs` usage is different in kind, not degree:

- **`briefing` mode** (default): in demo, upserts a single fixed demo run row for display purposes (not a gate). In production, reads the *other three* agents' `agent_runs` history to compute a `stale_agents` list for the briefing (via a per-agent cache TTL: 24h for ar-aging-agent, 4h for news-monitor-agent, 48h for sec-monitor-agent) — this is a staleness signal, not a self-rate-limit — then writes its own `agent_runs` row as a plain audit record, with no reject-if-recent check guarding it.
- **`question` mode**: no `agent_runs` interaction at all. Instead, enforces a **separate, newer mechanism**: a 10-questions-per-IP-per-day limit (`ip_question_counts` table + `fn_increment_ip_question_count` atomic RPC), active only when `DEMO_MODE` is true, checked before the first Anthropic call so a rejected request costs nothing. An `x-internal-test-secret` header (checked via constant-time comparison against the `CIA_INTERNAL_TEST_SECRET` Supabase secret) bypasses this for internal tooling, independent of `DEMO_MODE`.
- **`suggestions` mode**: no rate limit of any kind.

### ar-csv-upload — a CSV ingestion endpoint, not a monitoring agent

Confirmed directly: no `agent_runs` interaction, no rate limit, no `DEMO_MODE` self-reset — none of the monitoring-agent pattern applies. It resolves each uploaded row's customer via `customer_identifiers` (DUNS, then `internal_customer_code`; unresolvable rows are rejected, not name-matched), replaces that customer's open/overdue invoices, and refreshes `ar_aging_snapshots`. See "AR data ingestion" under Event flow below.

### Shared skills

Reusable logic in `supabase/functions/_shared/skills/`:

| Skill | Type | Purpose |
|-------|------|---------|
| `analyse-payment-behaviour` | Analytical | Calculates on-time rate, days early/late, payment health classification from transaction history |
| `parse-ar-csv` | Analytical | Parses uploaded AR aging CSVs — ERP column-alias mapping, date/amount normalization, validation warnings |
| `calculate-credit-limit-proposal` | Analytical | Determines whether to reduce a credit limit and by how much |
| `assess-composite-risk` | Analytical | Flags customers with corroborating signals from multiple agents |
| `aggregate-credit-scores` | Analytical | Combines multiple providers' credit signals into one aggregate score |
| `detect-rating-change` | Analytical | Detects and classifies a credit rating change between two snapshots |
| `normalise-credit-signal` | Analytical | Converts any provider's credit score to a common 0–100 scale |
| `fetch-sec-filing` | Integration | Fetches recent SEC filings via EDGAR API; detects risk keywords |
| `fetch-credit-score` | Integration | Provider-agnostic credit score fetcher; stubbed providers, not currently wired into any agent |
| `search-news` | Integration | Provider-agnostic news search with deduplication; used by news-monitor-agent |
| `deliver-message` | Integration | Provider-agnostic message delivery — `LogProvider`, `EmailProvider`, `TeamsProvider`, and `SlackProvider` are all already implemented and wired (cia-agent's credit-decisioning path selects between them based on which of `SENDGRID_API_KEY`/`TEAMS_WEBHOOK_URL`/`SLACK_WEBHOOK_URL` are set) |
| `compose-dunning-letter` | Generative | Calls Claude to draft a staged (1–4) dunning letter. **Not currently invoked by any agent** — the overdue-AR detection (`OVERDUE_AR`) is built and live, but the notification/letter-composition phase that would consume it is still on the roadmap. |
| `compose-teams-alert` | Generative | Pure text formatting (no external calls) — produces a subject/body pair suitable for Teams or email delivery, not an actual Teams Adaptive Card JSON payload |
| `classify-news` | Generative | Calls Claude Haiku to classify article severity with a strict JSON schema; used by news-monitor-agent for every classification |

---

## Database

Supabase Postgres. Schema is defined by `supabase/migrations/00000000000000_baseline.sql` (a full dump of the live schema at the time it was created) plus a real, growing chain of dated migrations layered on top of it since — no longer a single self-contained baseline; both are applied in filename order by `supabase db push`. Prior (pre-baseline) migration history (57 files) is preserved for reference in `supabase/migrations_archive/` but is no longer applied. Demo seed data is separate, in `supabase/seed.sql`, loaded independently of the schema (`supabase db push` then `psql -f supabase/seed.sql`).

### Core tables

| Table | Purpose |
|-------|---------|
| `customers` | Portfolio of monitored counterparties with credit limits, ratings, risk tags |
| `customer_identifiers` | Normalized external identifiers per customer (DUNS, ticker, CIK, LEI, internal_customer_code) — single source of truth; see `docs/CreditPilot_Customer_Identifier_Strategy.md`-equivalent design notes in the backlog |
| `credit_events` | Central event log — all agents write here, exclusively via `publishEvent` |
| `invoices` | Per-invoice AR records; source of truth for exposure and aging |
| `ar_aging_snapshots` | Per-customer aging buckets, refreshed via `fn_refresh_ar_aging` (called after every AR CSV upload, and available as `fn_refresh_all_ar_aging` for a full-portfolio refresh) |
| `agent_messages` | Composed communications (Teams alerts, etc.) |
| `pending_actions` | AI-proposed actions awaiting human approval; sole writer is `cia-agent` |
| `credit_actions` | Audit log of actions actually taken (approved from `pending_actions`) |
| `agent_runs` | Audit log of every agent execution |
| `negative_news` | News items written by the News Monitor Agent |
| `sec_monitoring` | Companies watched for SEC filing alerts |
| `sec_filings` | Fetched SEC filings with extracted risk signals |
| `payment_transactions` | Payment history used by the AR Aging Agent's payment-behaviour skill |
| `ip_question_counts` | Per-IP, per-day question-mode counters for cia-agent's rate limit (`ip_address`, `question_date`, `question_count`) |

### Key views

| View | Purpose |
|------|---------|
| `v_ar_aging_current` | Latest AR aging snapshot per customer — what the AR agent reads |
| `v_ar_aging_portfolio` | Portfolio-level AR rollup |
| (others) | See individual migration/view definitions; a full view inventory is maintained during schema-change sessions, not duplicated here to avoid drift |

### Demo data isolation

Demo rows are tagged `is_demo = true` across `credit_events`, `agent_messages`, `pending_actions`, `invoices`, and other agent-written tables. `customers` and `ar_aging_snapshots` are not tagged (all-or-nothing per environment) — see the backlog for the current status of full is_demo coverage.

---

## Event flow

```
User clicks "Run Agent" (or CSV upload triggers AR data change)
    │
    ▼
Frontend calls supabase.functions.invoke('ar-aging-agent', ...)
    │
    ▼
ar-aging-agent reads v_ar_aging_current + payment_transactions
    │
    └──► publishEvent writes credit_events (UTILIZATION_THRESHOLD_BREACH, OVERDUE_AR)
    │        Pure signal agent — does not write pending_actions
    ▼
Frontend calls supabase.functions.invoke('cia-agent', {mode:'briefing'})
    │
    ▼
cia-agent reads credit_events where cia_processed = false
    │
    ├──► calls Claude (live) or returns demo briefing content
    ├──► attempts to write DAILY_BRIEFING / COMPOSITE_RISK_CRITICAL / COMPOSITE_RISK_ELEVATED
    │        events — confirmed BROKEN: these event_type values aren't in the
    │        credit_events CHECK constraint, so every insert silently fails
    │        (error only console.error'd). Zero such rows exist in production.
    │        Deferred to v3/v4 — see docs/CreditPilot_Deferred_Backlog.md.
    ├──► writes pending_actions (proposed actions) ← sole owner
    └──► marks source events cia_processed = true
    │
    ▼
User reviews /actions, approves/rejects
    │
    └──► approval writes an audit row to credit_actions
```

**Sensing vs decision separation:** AR aging, news, and SEC agents are pure signal agents — they write `credit_events` only, via `publishEvent`, never `pending_actions` directly. The CIA agent is the sole owner of `pending_actions`. This ensures every proposed action passes through a single synthesis layer before reaching the human approval queue.

**AR data ingestion:** in addition to the scheduled/manual agent run, AR data can arrive via CSV upload (`ar-csv-upload` function). Upload resolves each row's customer via `customer_identifiers` (DUNS, then `internal_customer_code`; uploads without a resolvable identifier are rejected, not guessed at via name matching), replaces that customer's open/overdue invoices, and refreshes `ar_aging_snapshots` so the change is immediately visible to the next agent run.

---

## Auth and security

The demo uses open RLS policies so anyone can interact with the demo data without signing in. Before loading real company data:

1. ✅ Done (2026-09-20) — anon write policies removed from `pending_actions`, `customers`, `credit_events`, `credit_actions`, `agent_runs`, `negative_news`, `sec_monitoring`. Approve/reject and demo-reset writes now go through the `demo-actions` edge function (service role), not directly via the anon key. See `supabase/migrations/20260920000000_tighten_anon_write_rls.sql`.
2. Add Supabase Auth. — still open
3. Use a dedicated Supabase project — not the demo project. — still open

See the Security section in `README.md` for full guidance.
