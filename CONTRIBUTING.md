# Contributing to CreditPilot

Thank you for your interest in contributing. This document covers development setup, branch conventions, how to add a new agent, and the PR checklist.

---

## Development setup

### Prerequisites

- Node.js 18+
- Supabase CLI — `npm install -g supabase`
- A Supabase project (free tier works)
- An Anthropic API key

### Steps

```bash
git clone https://github.com/larsewallin/Creditpilot.git
cd Creditpilot
npm install
cp .env.example .env
# Edit .env with your Supabase URL and anon key
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). With `VITE_DEMO_MODE=true` the demo data loads automatically.

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
  functions/     # Edge functions (one directory per agent)
    _shared/
      skills/    # Reusable TypeScript skill functions
  migrations/    # SQL migration files (schema + seed data)
```

---

## Adding a new agent

1. Create `supabase/functions/<agent-name>/index.ts`.
2. Follow the existing agent pattern:
   - Check `DEMO_MODE` first and return early with seed data.
   - Enforce a 60-minute rate limit via `agent_runs`.
   - Insert a `running` record into `agent_runs` at the start.
   - Write findings to `credit_events` and `agent_messages`.
   - Mark `is_demo: DEMO_MODE` on every row you insert.
   - Update `agent_runs` to `completed` or `failed` at the end.
3. Deploy: `supabase functions deploy <agent-name>`.
4. Add the agent to `AppSidebar.tsx` run-status badges.
5. Document it in `docs/AGENTS.md`.

### Event types

Write descriptive, SCREAMING_SNAKE_CASE event types. Reuse existing types where appropriate. See `docs/AGENTS.md` for the full taxonomy.

### Skills

Reusable logic (Claude API calls, financial calculations) goes in `supabase/functions/_shared/skills/`. Analytical skills (pure functions) go in `analytical/`, generative skills (Claude API calls) go in `generative/`.

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
