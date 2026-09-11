# Deployment

CreditPilot has two deployment targets:

- **Frontend** — Vercel (or any static host)
- **Backend** — Supabase (database + edge functions)

---

## 1. Supabase project setup

1. Create a project at [supabase.com](https://supabase.com). The free tier works.
2. Note your **Project URL** and **anon key** from Settings → API.
3. Note your **Project Ref** (the short ID in your project URL).

---

## 2. Apply the database schema

```bash
supabase login
supabase link --project-ref your-project-ref
supabase db push
```

This runs all 14 migration files in `supabase/migrations/` in order, creating the full schema and seeding the demo data.

If `supabase db push` fails with a password error, you can run the migrations manually in the Supabase dashboard SQL editor (Database → SQL Editor → paste each file in order).

---

## 3. Set edge function secrets

In the Supabase dashboard → Edge Functions → Manage secrets, add:

| Secret | Value |
|--------|-------|
| `ANTHROPIC_API_KEY` | `sk-ant-...` (required for live mode; optional for demo mode) |
| `DEMO_MODE` | `true` (for demo) or `false` (for production) |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by Supabase — do not set them manually.

### Optional delivery secrets

These enable real message delivery. If not set, all messages fall back to `LogProvider` (console logging). No delivery keys are needed for demo mode.

| Secret | Description |
|--------|-------------|
| `CREDIT_TEAM_EMAIL` | Recipient for SEC alert emails (defaults to `credit-team@company.com`) |
| `SENDGRID_API_KEY` | Enables email delivery via SendGrid |
| `TEAMS_WEBHOOK_URL` | Enables Teams delivery via incoming webhook |
| `SLACK_WEBHOOK_URL` | Enables Slack delivery via incoming webhook |
| `ATRADIUS_API_KEY` | Optional — enables Atradius credit score fetching |
| `EULER_HERMES_API_KEY` | Optional — enables Euler Hermes credit score fetching |

---

## 4. Deploy edge functions

```bash
supabase functions deploy ar-aging-agent
supabase functions deploy news-monitor-agent
supabase functions deploy sec-monitor-agent
supabase functions deploy cia-agent
```

---

## 5. Deploy the frontend to Vercel

### Option A — Vercel dashboard (recommended)

1. Push your repository to GitHub.
2. Go to [vercel.com](https://vercel.com) → New Project → import your repo.
3. Vercel will detect Vite automatically.
4. Add environment variables under Project Settings → Environment Variables:

| Variable | Value |
|----------|-------|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Your Supabase anon key |
| `VITE_DEMO_MODE` | `true` or `false` |

5. Deploy.

### Option B — Vercel CLI

```bash
npm install -g vercel
vercel login
vercel --prod
```

Follow the prompts. Set the same three environment variables when asked.

---

## 6. Custom domain

In Vercel → Project → Settings → Domains, add your domain and follow the DNS instructions.

---

## Promoting from demo to production

1. Create a new Supabase project — do not reuse the demo project.
2. Apply the schema (`supabase db push`) without the seed data migrations, or run only the schema migrations (files 1–10).
3. Load real customer data into `customers`, `ar_aging`, `payment_transactions`, `negative_news`, `sec_monitoring`.
4. Set `DEMO_MODE=false` in edge function secrets.
5. Set `VITE_DEMO_MODE=false` in Vercel environment variables.
6. Harden RLS policies:
   - Remove anon write policies from `pending_actions`, `customers`, `credit_events`.
   - Add Supabase Auth and row-level policies tied to authenticated user roles.
7. Redeploy: `supabase functions deploy --all` and trigger a new Vercel deployment.

---

## Environment variable reference

### Frontend (`.env` / Vercel)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | Yes | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase anon/public key |
| `VITE_DEMO_MODE` | Yes | `true` for demo data, `false` for live data |

### Supabase edge function secrets

| Secret | Required | Description |
|--------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes (live mode) | Anthropic API key for Claude calls |
| `DEMO_MODE` | Yes | `true` replays seed data without API calls (except CIA question mode) |
| `SUPABASE_URL` | Auto | Set automatically by Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto | Set automatically by Supabase |
| `CREDIT_TEAM_EMAIL` | No | Recipient for SEC alert emails (defaults to `credit-team@company.com`) |
| `SENDGRID_API_KEY` | No | Enables email delivery via SendGrid |
| `TEAMS_WEBHOOK_URL` | No | Enables Teams delivery via incoming webhook |
| `SLACK_WEBHOOK_URL` | No | Enables Slack delivery via incoming webhook |
| `ATRADIUS_API_KEY` | No | Enables Atradius credit score fetching |
| `EULER_HERMES_API_KEY` | No | Enables Euler Hermes credit score fetching |

No delivery keys are needed for demo mode — `LogProvider` fallback logs all messages to the console.
