# Contributing to CreditPilot

Thank you for your interest in contributing. This document covers development setup, branch conventions, how to add a new agent or skill, and the PR checklist.

---

## Development setup

### Prerequisites

- Node.js 18+
- Supabase CLI — `npm install -g supabase`
- A Supabase project (free tier works)
- An Anthropic API key
- A Tavily API key (optional — news-monitor-agent falls back to demo mode without it)

### Steps

```bash
git clone https://github.com/larsewallin/Creditpilot.git
cd Creditpilot
npm install
cp .env.example .env
# Edit .env with your Supabase URL and publishable key
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). With `VITE_DEMO_MODE=true` the demo data loads automatically.

Apply migrations in `supabase/migrations/` (in filename order) via `supabase db push`, or paste them into the Supabase SQL Editor.

### Running edge functions locally

```bash
supabase start
supabase functions serve ar-aging-agent --env-file supabase/.env.local
```

Create `supabase/.env.local` with:

```
ANTHROPIC_API_KEY=sk-ant-...
DEMO_MODE=true
```

### Running tests

```bash
npm test          # run once
npm run test:watch  # watch mode
```

Tests live alongside the skills they cover, e.g. `supabase/functions/_shared/skills/analytical/__tests__/`.

---

## Branch conventions

| Branch | Purpose |
|--------|---------|
| `main` | Production-ready code |
| `feat/<name>` | New features |
| `fix/<name>` | Bug fixes |
| `docs/<name>` | Documentation only |
| `refactor/<name>` | Refactoring without behaviour change |

Open a PR against `main`. Squash merges are preferred.

---

## Project structure

```
src/
  components/    # Shared UI components
  hooks/         # React hooks (useCIA, etc.)
  lib/           # Utilities, constants, demo init logic
  pages/         # One file per route
supabase/
  functions/
    _shared/
      skills/
        analytical/    # Pure analysis functions, no API calls (e.g. analyse-payment-behaviour.ts, calculate-credit-limit-proposal.ts)
        generative/     # LLM-backed composition with template fallbacks (e.g. compose-dunning-letter.ts, compose-teams-alert.ts, classify-news.ts)
        integration/    # External API wrappers (e.g. search-news.ts)
    ar-aging-agent/     # AR Aging Agent
    ar-csv-upload/      # AR CSV Upload Agent
    cia-agent/          # Credit Intelligence Agent
    news-monitor-agent/ # News Monitor Agent
    sec-monitor-agent/  # SEC Monitor Agent
  migrations/    # SQL migration files (schema + seed data)
```

---

## Adding a new agent

1. Create `supabase/functions/<agent-name>/index.ts`.
2. Follow the existing agent pattern:
   - Check `DEMO_MODE` first and return early with seed data.
   - Enforce a 60-minute rate limit via `agent_runs`.
   - Insert a `running` record into `agent_runs` at the start.
   - Query data, then call skills — don't put analysis/composition logic directly in the agent.
   - Write findings to `credit_events` and `agent_messages`.
   - Write proposed actions to `pending_actions` where applicable.
   - Mark `is_demo: DEMO_MODE` on every row you insert.
   - Update `agent_runs` to `completed` or `failed` at the end, with stats and a summary.
3. Deploy: `supabase functions deploy <agent-name>`.
4. Add the agent to `AppSidebar.tsx` run-status badges.
5. Document it in `docs/AGENTS.md`.

### Event types

Write descriptive, SCREAMING_SNAKE_CASE event types. Reuse existing types where appropriate. See `docs/AGENTS.md` for the full taxonomy.

---

## Adding or improving a skill

Reusable logic (Claude API calls, financial calculations, external data retrieval) goes in `supabase/functions/_shared/skills/`.

### Skill contract

Every skill must:
- Export a named TypeScript function (not a default export)
- Define TypeScript interfaces for inputs and outputs
- Do ONE thing only
- Have no database writes or side effects — pure input/output
- Handle empty/null inputs gracefully with safe defaults
- Include a JSDoc header with: skill name, type, what it does, input, output, which agents use it

### Steps

1. Identify the category: `analytical` / `generative` / `integration`.
2. Create `supabase/functions/_shared/skills/[category]/your-skill.ts`.
3. Follow the skill contract above.
4. Add unit tests in `supabase/functions/_shared/skills/[category]/__tests__/your-skill.test.ts` (analytical skills are easiest to unit test directly; generative and integration skills require API mocking).
5. Update the `@usedBy` JSDoc line in any agent that calls the skill.
6. Update `supabase/functions/_shared/skills/SKILLS.md`.

### Category guide

| Category | Description | External calls |
|----------|-------------|----------------|
| analytical | Pure calculation and analysis | None |
| generative | LLM-backed composition with template fallback | Anthropic API (optional) |
| integration | External data retrieval | Tavily, EDGAR, etc. |

---

## Environment variables

### Supabase Edge Function secrets

```
ANTHROPIC_API_KEY=sk-ant-...
TAVILY_API_KEY=tvly-...
```

Set with: `supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`

### UI `.env` file

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key-here
```

---

## PR checklist

- [ ] Code runs locally without errors
- [ ] `DEMO_MODE=true` path tested — agent returns seed data, no API calls
- [ ] All new `credit_events` / `agent_messages` rows include `is_demo` flag
- [ ] No hardcoded secrets or API keys
- [ ] Edge function includes rate-limit guard
- [ ] Documentation updated if behaviour changed
- [ ] If a skill was added, modified, or removed: `supabase/functions/_shared/skills/SKILLS.md` updated

---

## Reporting issues

Open an issue on [GitHub](https://github.com/larsewallin/Creditpilot/issues) with:
- Steps to reproduce
- Expected vs. actual behaviour
- Browser / Supabase CLI version if relevant
