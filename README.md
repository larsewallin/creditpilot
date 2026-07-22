# CreditPilot

Open-source autonomous AI agents for trade credit management.

---

## What is CreditPilot?

CreditPilot is an open-source project of autonomous AI agents for B2B trade credit management. Agents monitor overdue AR, scan for negative news, watch SEC filings for distress signals, and synthesise everything into a daily credit intelligence briefing — surfaced through a React dashboard and a Perplexity-style chat interface.

Think of it as "Perplexity for trade credit."

Agents write their findings as structured credit events to a Postgres database, compose dunning letters and alerts, and propose actions (credit limit reductions, credit holds) for human approval. Nothing changes without a credit manager signing off. The Credit Intelligence Agent (CIA) answers questions in natural language, citing the specific signals behind its reasoning.

The repo is designed for local deployment — your AR data, customer financials, and credit events stay on your own infrastructure. The hosted demo uses Supabase, Vercel, and the Anthropic Claude API.

A live demo is available at creditpilot.vercel.app — a fictional $500M specialty alloys distributor with 59 customers across seven credit scenarios. No signup required.

See [docs/USER_GUIDE.md](docs/USER_GUIDE.md) for a non-technical walkthrough of what CreditPilot does and how it's structured.

---

## How It Works

```
DATA IN
Customer master data → customers table (manual setup or CSV)
AR aging export      → invoices table (CSV upload from any ERP)
News                 → Tavily API (live fetch) or existing rows
SEC filings          → SEC EDGAR API (live, free, no key required)
Credit scores        → D&B, Coface, Experian (stubbed, ready to wire)

AGENTS READ AND SIGNAL
AR Aging Agent  → reads invoices → writes OVERDUE_AR, UTILIZATION_THRESHOLD_BREACH credit_events
News Agent      → fetches + classifies news → writes NEWS_EVENT credit_events
SEC Agent       → fetches EDGAR filings → writes GOING_CONCERN, SEC_OTHER credit_events
(SEC agent automatically skips private companies with no CIK)

CIA SYNTHESISES
Reads all unprocessed credit_events
Detects multi-signal convergence (same customer flagged by 2+ agents)
Runs assessCompositeRisk → calculateCreditLimitProposal
Writes COMPOSITE_RISK_CRITICAL / COMPOSITE_RISK_ELEVATED credit_events + pending_actions
Answers natural language questions with cited sources

HUMAN REVIEWS
Credit Events page → review all signals (read only)
Actions page       → approve or reject AI-proposed actions
CIA chat           → ask questions about the portfolio
Nothing changes without human approval

EXECUTED
Approved action → customers.credit_limit updated
Full audit trail written to credit_events
```

---

## Architecture

```
React / Vite frontend  →  Supabase Edge Functions (Deno)
                       →  Supabase Postgres
                       →  Anthropic Claude API
```

Agents are Supabase Edge Functions written in TypeScript/Deno. They read from and write to a shared Postgres database. The frontend is a Vite/React SPA that queries Postgres directly via the Supabase client. There is no separate API server.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full system diagram and event-driven design.

---

## Data Residency

CreditPilot is designed for self-hosted deployment. Your AR data, customer financials, and credit events never need to leave your infrastructure. The Supabase stack (Postgres + Edge Functions) can run on your own Supabase project or on-premise Postgres. The only external calls are to the Anthropic Claude API for AI synthesis — and this can be replaced with a local LLM if required.

The hosted demo at https://creditpilot.vercel.app uses Supabase Cloud and Anthropic's API. For production deployments handling real company data, self-hosting is strongly recommended.

### What Vercel sees
Only your compiled frontend code (HTML/JS/CSS). No database queries pass through Vercel — all data fetches go directly from the browser to Supabase.

### What Supabase sees
All your company data — customers, invoices, AR aging, credit events, agent messages. In self-hosted mode, this runs on your own infrastructure. In cloud mode, Supabase hosts on AWS with SOC 2 Type II compliance.

### What the Anthropic API receives
Only the CIA and dunning letter agents make external API calls. The following data is sent:

| Agent | Mode | Data sent to Anthropic |
|-------|------|----------------------|
| AR Aging | Dunning letter | Company name, overdue amounts, utilization %, payment rate, dunning stage |
| News Monitor | Classification | Article headline and summary (already public) |
| CIA | Briefing | Customer names, credit limits, balances, event types and descriptions |
| CIA | Question | Same as briefing, filtered to relevant customers + user question text |
| CIA | Suggestions | Event types and severities only |

Invoice numbers, internal account IDs, and payment transaction details are never sent to the Anthropic API.

**Note on customer data and privacy:** Customer names and financial data sent to the CIA agent are processed under Anthropic's API terms. Anthropic does not train on API data by default — see [Anthropic's privacy policy](https://www.anthropic.com/privacy). For deployments where customer identity must stay on-premise, use the local LLM option or configure CIA to send anonymised customer IDs instead of names.

### Local LLM option
Replace the Anthropic API with a local model (e.g. Ollama) by implementing the same interface in `cia-agent/index.ts` and the generative skills. In fully local mode, no data leaves your infrastructure.

---

## Agents

### AR Aging Agent (`ar-aging-agent`)
Pure signal agent — scans AR data for overdue buckets and credit utilization. Writes `credit_events` only (OVERDUE_AR, UTILIZATION_THRESHOLD_BREACH). Composes Teams alerts. (Dunning-letter composition is a built skill, not yet wired into the agent — planned.)

### News Monitor Agent (`news-monitor-agent`)
Fetches live news via the Tavily API, classifies severity using Claude Haiku with strict JSON schema and confidence scoring, deduplicates by content fingerprint, and writes to negative_news and credit_events. Falls back to processing existing unreviewed rows if no Tavily API key is set.

### SEC Filing Monitor Agent (`sec-monitor-agent`)
Fetches live filings from the SEC EDGAR API (free, no API key required). Detects risk signals via keyword matching across 15 signal types. Deduplicates by accession number. Composes email alerts to the credit analysis team via `deliver-message.ts`.

### Credit Intelligence Agent (`cia-agent`)
Synthesises signals from all three monitoring agents into structured intelligence. Operates in three modes: `briefing` (daily portfolio summary, calls Claude Opus), `question` (answers a specific credit question with cited sources, calls Claude Sonnet), and `suggestions` (generates relevant follow-up questions, calls Claude Haiku). Writes `DAILY_BRIEFING` and `COMPOSITE_RISK` events back to `credit_events` and marks source events as processed. Owns all credit limit decisioning — runs `assessCompositeRisk` and `calculateCreditLimitProposal` skills, writes `pending_actions`.

See [docs/AGENTS.md](docs/AGENTS.md) for full agent documentation including event taxonomies.

More agents will be added.

---

## Data Ingestion

### Customer Master Data
Before agents can run, load your customer portfolio into the `customers` table. Each record requires:

| Field | Required | Notes |
|-------|----------|-------|
| `company_name` | Yes | Used for news search and display |
| `company_type` | Yes | `public`, `private`, or `sme` |
| `credit_limit` | Yes | In your base currency |
| `country_code` | No | ISO 3166-1 alpha-2; defaults to `US` |

External identifiers (ticker, SEC CIK, DUNS, LEI) are **not** columns on `customers` — they live in the separate `customer_identifiers` table (one row per identifier, supporting multiple identifier types per customer). Public-company tickers and CIKs are loaded there; the SEC agent reads CIKs from it and skips customers with none.

Private and SME companies are fully supported. The news agent searches by company name. The SEC agent automatically skips companies with no CIK. Credit scoring works for all company types via manual entry or CSV import.

The difference between `private` and `sme` is intentional but currently a data quality label — future agents will apply different thresholds and workflows for each. Use `private` for larger private companies and `sme` for smaller suppliers typically under $50M revenue.

**V1 — Manual setup:** Insert customers via the Supabase dashboard, the AR aging CSV upload, or by loading the demo seed (`supabase/seed.sql`). The demo dataset includes 49 public companies and 10 private/SME customers as a reference.

**Planned:** CSV import for customer master data, ERP API integration for automatic sync.

### AR Data
Upload an AR aging CSV export from any ERP (SAP, NetSuite, QuickBooks, Dynamics) via the Upload AR Data button on the AR Aging page. Column headers are auto-detected with 40+ aliases. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the expected schema.

### News
The News Monitor Agent fetches live news via the Tavily API. Set `TAVILY_API_KEY` in Supabase function secrets. Without a key, the agent processes any existing rows in the `negative_news` table.

### SEC Filings
The SEC Monitor Agent uses the free SEC EDGAR API — no key required. Monitored companies are configured in the `sec_monitoring` table.

### Credit Scores
Credit scores from D&B, Coface, Experian, and other providers are normalised to a 0–100 scale via `normalise-credit-signal.ts`. API integrations are stubbed in `fetch-credit-score.ts` — ready to wire when API keys are available. Scores can also be entered manually on the Customers page.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui |
| Routing | React Router v6 |
| Data fetching | TanStack Query (React Query) |
| Backend | Supabase Edge Functions (Deno) |
| Database | Supabase Postgres (PostgREST) |
| AI | Anthropic Claude API (Opus, Sonnet, Haiku) |
| Deployment | Vercel (frontend), Supabase (database + functions) |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) 18+
- [Supabase CLI](https://supabase.com/docs/guides/cli) — `npm install -g supabase`
- A Supabase project ([supabase.com](https://supabase.com), free tier works)
- An [Anthropic API key](https://console.anthropic.com)

### 1. Clone and install

```bash
git clone https://github.com/larsewallin/Creditpilot.git
cd Creditpilot
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` with your Supabase project URL and anon key (Settings → API in the Supabase dashboard).

### 3. Apply the database schema

```bash
supabase login
supabase link --project-ref your-project-ref
supabase db push
```

This applies the schema baseline in `supabase/migrations/`, creating the complete database structure (tables, functions, triggers, views, and row-level security policies). It does **not** load any data — a fresh deployment starts empty, ready for your own customers and invoices.

### 3a. (Optional) Load the demo dataset

To explore CreditPilot with sample data — 59 fictional customers across seven credit scenarios, with invoices, payments, AR aging, and news/SEC signals — load the demo seed:

```bash
psql "$DATABASE_URL" -f supabase/seed.sql
```

Skip this step for a production deployment; your real data enters via the AR aging CSV upload. The demo seed and your production data are mutually exclusive — a clean clone has no demo rows to remove.

> **Note:** A hosted demo is also available at [creditpilot.vercel.app](https://creditpilot.vercel.app) — no setup required.

### 4. Set Supabase function secrets

In the Supabase dashboard → Edge Functions → Manage secrets, add:

```
ANTHROPIC_API_KEY = sk-ant-...
DEMO_MODE         = false
TAVILY_API_KEY    = tvly-...   # optional — enables live news search
```

To try the demo first, set `DEMO_MODE = true` and leave `TAVILY_API_KEY` unset.

### 5. Deploy the edge functions

```bash
supabase functions deploy ar-aging-agent
supabase functions deploy news-monitor-agent
supabase functions deploy sec-monitor-agent
supabase functions deploy cia-agent
```

### 6. Run the frontend

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

> To try the demo without any setup, visit [creditpilot.vercel.app](https://creditpilot.vercel.app).

---

## Security

Before loading real company data, lock down your Supabase project:

1. Remove anon write policies from `pending_actions`, `customers`, `credit_actions`
2. Add authentication (Supabase Auth)
3. Use a dedicated Supabase project — not the same one as the demo

The demo deployment uses intentionally open RLS policies so anyone can interact with the seed data. These must be replaced before going to production.

---

## Environment Variables

### Frontend (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | Yes | Your Supabase project URL (e.g. `https://xxx.supabase.co`) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Yes | Your Supabase anon/public key |
| `VITE_DEMO_MODE` | Yes | `true` to use seed data, `false` for live data |

### Supabase Function Secrets

Set these in the Supabase dashboard → Edge Functions → Manage secrets:

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes (live mode) | Anthropic API key for Claude calls |
| `DEMO_MODE` | Yes | `true` replays seed data without API calls (except CIA question mode) |
| `SUPABASE_URL` | Auto | Set automatically by Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto | Set automatically by Supabase |
| `TAVILY_API_KEY` | No | Enables live news fetching via Tavily API |
| `CREDIT_TEAM_EMAIL` | No | Recipient for SEC alert emails (defaults to `credit-team@company.com`) |
| `SENDGRID_API_KEY` | No | Enables email delivery via SendGrid |
| `TEAMS_WEBHOOK_URL` | No | Enables Teams delivery via incoming webhook |
| `SLACK_WEBHOOK_URL` | No | Enables Slack delivery via incoming webhook |

No delivery keys are needed for demo mode — `LogProvider` fallback logs all messages to the console.

---

## Database

The schema is defined across SQL migration files in `supabase/migrations/`. Key tables:

| Table | Purpose |
|-------|---------|
| `customers` | Portfolio of monitored counterparties with credit limits |
| `credit_events` | Central event log — all agents write here |
| `agent_messages` | Composed communications (dunning letters, Teams alerts) |
| `pending_actions` | AI-proposed actions awaiting human approval |
| `agent_runs` | Audit log of every agent execution |
| `negative_news` | News items for the news monitor agent to process |
| `sec_monitoring` | Companies being watched for SEC filing alerts |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for schema details and relationships.

---

## Demo Mode

Demo-generated rows are tagged with `is_demo = true`. This column exists on `credit_events`, `agent_messages`, `pending_actions`, `invoices`, `payment_transactions`, `negative_news`, `sec_filings`, and `sec_monitoring`. The Reset Demo button on the Actions page resets demo row state — pending actions back to pending, processed flags cleared, seed credit limits restored — then re-invokes the agents to regenerate their outputs. It does not recreate the underlying seed data (customers, invoices, etc.); those are loaded once via `supabase/seed.sql` and persist.

See [docs/DEMO_MODE.md](docs/DEMO_MODE.md) for full details.

---

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for full deployment instructions including Vercel configuration, Supabase project setup, and promoting from demo to production.

---

## Project Structure

```
creditpilot/
├── src/
│   ├── components/
│   │   ├── AppSidebar.tsx         # Navigation sidebar with agent run status badges
│   │   ├── CIAChat.tsx            # CIA launcher bar — bottom of every page
│   │   ├── AgentPill.tsx          # Colored pill showing which agent produced an event
│   │   ├── SeverityBadge.tsx      # Critical/high/medium/low severity indicator
│   │   ├── SkeletonCard.tsx       # Loading skeleton components
│   │   └── ui/                    # shadcn/ui component library (do not edit)
│   ├── hooks/
│   │   └── use-toast.ts           # Toast notification hook
│   ├── lib/
│   │   ├── constants.ts           # DEMO_MODE flag, agent config
│   │   ├── format.ts              # Currency and date formatting
│   │   ├── initDemo.ts            # Demo reset logic — shared by Reset button and auto-init
│   │   └── utils.ts               # Tailwind class merging (cn utility)
│   ├── pages/
│   │   ├── CreditEvents.tsx       # Default landing page — unified signal log
│   │   ├── Actions.tsx            # Pending and completed human approvals
│   │   ├── ArAging.tsx            # AR aging dashboard
│   │   ├── NewsMonitor.tsx        # Negative news alert feed
│   │   ├── SecFilings.tsx         # SEC filing monitoring with EDGAR links
│   │   ├── Customers.tsx          # Customer directory with credit metrics
│   │   └── CIA.tsx                # Perplexity-style CIA answer page (/cia?q=...)
│   └── App.tsx                    # Route definitions, SidebarLayout, demo auto-init
├── supabase/
│   ├── functions/
│   │   ├── _shared/
│   │   │   └── skills/            # Reusable skill functions
│   │   │       ├── analytical/    # analyse-payment-behaviour, calculate-credit-limit-proposal,
│   │   │       │                  #   assess-composite-risk, aggregate-credit-scores,
│   │   │       │                  #   detect-rating-change, normalise-credit-signal, parse-ar-csv
│   │   │       ├── integration/   # fetch-sec-filing, fetch-credit-score, deliver-message, search-news
│   │   │       └── generative/    # classify-news, compose-dunning-letter, compose-teams-alert
│   │   ├── ar-aging-agent/        # AR Aging monitoring agent
│   │   ├── ar-csv-upload/         # CSV ingestion endpoint for AR data
│   │   ├── news-monitor-agent/    # Negative news monitoring agent
│   │   ├── sec-monitor-agent/     # SEC filing monitoring agent
│   │   └── cia-agent/             # Credit Intelligence Agent (synthesis + Q&A)
│   ├── migrations/                # Schema baseline (single migration)
│   ├── migrations_archive/        # Historical migration chain (reference only)
│   └── seed.sql                   # Demo dataset (optional, loaded separately)
├── .env.example                   # Frontend env var template
├── CONTRIBUTING.md
└── README.md
```

---

## Testing

The skill layer has **148 unit tests** across 9 test files (run under vitest):

```bash
npx vitest run supabase/functions/_shared/skills
```

Tests cover: `normalise-credit-signal` (36), `parse-ar-csv` (29), `aggregate-credit-scores` (15), `detect-rating-change` (14), `assess-composite-risk` (13), `calculate-credit-limit-proposal` (13), `classify-news` (12), `analyse-payment-behaviour` (11), `deliver-message` (5). The `fetch-sec-filing` skill's test requires the Deno runtime (it imports the Supabase client via Deno's remote-import mechanism) and is not part of the Node/vitest suite.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, branch conventions, how to add a new agent, and the PR checklist.

---

## License

MIT — use it, fork it, build on it.

---

## About

Hi, I'm Lars.
By day I work at Coface — one of the world's largest trade credit insurance companies — as Head of Financial Institutions. This project applies 15+ years of domain expertise in trade credit, AR financing, and credit risk to autonomous AI agents for B2B credit management.

I built CreditPilot to explore what's possible when practitioners build their own tools. The best credit software has always been written by people who've actually sat in the chair.

If you're working on trade credit, AR financing, or AI in financial services — I'd love to connect.

LinkedIn

The demo company and all 59 customer accounts are entirely fictional.
