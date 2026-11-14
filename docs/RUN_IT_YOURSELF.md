# Run CreditPilot yourself

Two ways: the demo on your own computer (one command), or your own production install on a free Supabase project. Both run the same code as the hosted demo; the only switch between demo and production is `DEMO_MODE`.

## A. The demo on your computer

You need [Docker Desktop](https://docs.docker.com/get-docker/) (running) and [Node.js](https://nodejs.org) 18 or newer.

```bash
git clone https://github.com/larsewallin/creditpilot.git
cd creditpilot
scripts/setup-local.sh
```

This starts a local Supabase stack in Docker (database, sign-in, edge functions), applies every migration, loads the demo data (82 fictional customers with invoices, payments, news and filings) and creates three sign-in accounts, whose passwords it prints once. Then, in two terminal windows:

```bash
npx supabase@3.1.0 functions serve --env-file supabase/functions/.env.local   # agents and CIA
npm run dev                                                                    # web app
```

Open http://localhost:5173, sign in, and press **Reset Demo** on the Actions page to run the agents on the sample data.

Optional keys, read from your shell when you run the setup script:

| Variable | What it adds |
| --- | --- |
| `ANTHROPIC_API_KEY` | CIA answers questions; AI tagging in the agents |
| `TAVILY_API_KEY` | Live news search for the News agent (production) |
| `KEEN_API_KEY` | Keen scores at onboarding (ask the Keen team for a key); without it, onboarding uses your other score sources |

Company Lookup and Trade Credit Monitor use their free hosted copies. Point `COMPANY_LOOKUP_URL` or `TCM_API_URL` at your own copies if you run them (both are MIT and run with `npm run dev`).

`scripts/setup-local.sh --empty` sets up the same stack without the demo data. Stop everything with `npx supabase@3.1.0 stop`.

The same setup runs from scratch in CI on every change to the schema, the seed or the setup script (`.github/workflows/fresh-install.yml`), so it stays working.

## B. Your own production install

1. **Create a Supabase project** at supabase.com (the free tier works). Note its project ref, URL, anon key and service role key (Project Settings → API).
2. **Create the database** from this repo (no demo data):
   ```bash
   npx supabase@3.1.0 login
   npx supabase@3.1.0 link --project-ref <your-ref>
   npx supabase@3.1.0 db push
   ```
3. **Set the function secrets** (Edge Functions → Secrets):

   | Secret | Value |
   | --- | --- |
   | `DEMO_MODE` | `false` |
   | `ANTHROPIC_API_KEY` | your Anthropic key |
   | `SCHEDULER_SECRET` | a long random value (`openssl rand -hex 32`) |
   | `TAVILY_API_KEY`, `KEEN_API_KEY` + `KEEN_API_URL`, `COMPANIES_HOUSE_API_KEY` | optional |

4. **Let the scheduler call the agents.** In the SQL editor, store the project URL and the same scheduler secret in Vault (pg_cron reads them every 15 minutes):
   ```sql
   select vault.create_secret('https://<your-ref>.supabase.co', 'project_url');
   select vault.create_secret('<the SCHEDULER_SECRET value>', 'scheduler_secret');
   ```
5. **Deploy the functions:** `npx supabase@3.1.0 functions deploy --project-ref <your-ref>`.
6. **Deploy the web app** (Vercel or any static host) with `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and `VITE_DEMO_MODE=false`.
7. **Create the accounts:** `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/create-demo-users.mjs`, then change their addresses and roles in Supabase Auth, or create your own users there. There is no public sign-up.
8. **Load your data:** customers through onboarding or the AR aging CSV upload (AR Aging page).
9. **Choose when the agents run:** Settings › Agent schedules (defaults: news every 6 hours, SEC every 12, the rest daily, then the Risk agent and CIA's proposed actions). Settings › Credit score source puts Keen or your provider (D&B, Creditsafe, Coface, Allianz Trade, Experian…) first. "What would run now?" in Settings shows what the scheduler will start.

What changes with `DEMO_MODE=false`: the agents read live sources instead of the seed tables, the scheduler starts them on your schedules, customers are re-scored from Keen (monthly or after a new 10-K) when Keen is your first score source, and nothing ever self-resets.
