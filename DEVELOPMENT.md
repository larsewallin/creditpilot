# Developing CreditPilot

## Prerequisites
- Node.js 18+
- Supabase account (free tier works)
- Anthropic API key
- Tavily API key (optional — news agent runs in demo mode without it)

## Local setup in 5 minutes

### 1. Clone and install
```bash
git clone https://github.com/larsewallin/Creditpilot.git
cd Creditpilot
npm install
```

### 2. Set up environment
```bash
cp .env.example .env
# Fill in: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
```

In Supabase SQL Editor or via `supabase db push`, apply the migrations in `supabase/migrations/` (in filename order).

### 4. Deploy agents to Supabase
```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy ar-aging-agent
supabase functions deploy news-monitor-agent
```

### 5. Run the UI
```bash
npm run dev
# Opens at http://localhost:5173
```

---

## Running tests

```bash
npm test          # run once
npm run test:watch  # watch mode
```

Tests live in `supabase/functions/_shared/skills/analytical/__tests__/`.

---

## Repository structure

```
supabase/functions/
├── _shared/
│   └── skills/
│       ├── analytical/           # Pure analysis functions (no API calls)
│       │   ├── analyse-payment-behaviour.ts
│       │   ├── calculate-credit-limit-proposal.ts
│       │   ├── calculate-altman-z.ts
│       │   └── __tests__/
│       ├── generative/           # LLM-backed composition with fallbacks
│       │   ├── compose-dunning-letter.ts
│       │   ├── compose-teams-alert.ts
│       │   └── classify-news.ts
│       └── integration/          # External API wrappers
│           └── search-news.ts
├── ar-aging-agent/               # AR Aging Agent (thin orchestrator)
├── news-monitor-agent/           # News Monitor Agent (thin orchestrator)
└── sec-monitor-agent/            # SEC Monitor Agent
```

---

## Adding a new agent

1. Create `supabase/functions/your-agent-name/index.ts`
2. Follow the pattern in `ar-aging-agent/index.ts`:
   - Rate limit check
   - Insert `agent_runs` record (status: running)
   - Query data
   - Call skills — don't put analysis/composition logic directly in the agent
   - Write findings to the appropriate table
   - Write messages to `agent_messages`
   - Write proposed actions to `pending_actions`
   - Update `agent_runs` with stats and summary
3. Add a Run button on the `/demo` page in `src/pages/Demo.tsx`
4. Deploy: `supabase functions deploy your-agent-name`

---

## Adding or improving a skill

### Skill contract
Every skill must:
- Export a named TypeScript function (not a default export)
- Define TypeScript interfaces for inputs and outputs
- Do ONE thing only
- Have no database writes or side effects — pure input/output
- Handle empty/null inputs gracefully with safe defaults
- Include a JSDoc header with: skill name, type, what it does, input, output, which agents use it

### Steps
1. Identify the category: `analytical` / `generative` / `integration`
2. Create `supabase/functions/_shared/skills/[category]/your-skill.ts`
3. Follow the skill contract above
4. Add unit tests in `supabase/functions/_shared/skills/analytical/__tests__/your-skill.test.ts`
   (analytical skills only — generative and integration skills require API mocking)
5. Update the `@usedBy` JSDoc line in any agent that calls the skill

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
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```
