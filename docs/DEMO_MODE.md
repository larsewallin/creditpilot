# Demo Mode

The public demo at [creditpilot.vercel.app](https://creditpilot.vercel.app) runs on a fictional portfolio, so anyone can try CreditPilot without signing up and without touching real data. It runs the same agents, pages and assistant as a real install.

---

## The demo portfolio: one story table

The whole demo comes from one file, [`supabase/functions/_shared/demo/stories.ts`](../supabase/functions/_shared/demo/stories.ts): **40 fictional customers** in the US, Germany, the UK and Japan. 27 are steady payers; 13 each have one story (a bankruptcy, a going-concern doubt, a customer over its limit, payments getting slower, negative news, a score drop, and so on).

`buildDemo(today)` derives every row from that table, relative to today: invoices (due = issue date + terms), payments (paid = due date + the story's lateness), open balances, scores, seed news and SEC filings. Nothing in the demo stores a calendar date of its own, so the same story plays every day with today's dates.

Every company, person, score, invoice, payment, event and news item is invented. Websites are on `example.com` and news comes from "Demo Newswire".

**The rule:** demo rows are never added or changed by a migration or by hand. Change the story table, and its expected outcome, in the same pull request.

## Rebuild and Reset Demo

- **Daily refresh** (04:00 New York) and the **Reset Demo** button both call `demo-actions` → `rebuildDemo` ([`_shared/demo/rebuild.ts`](../supabase/functions/_shared/demo/rebuild.ts)): the demo rows are deleted and rebuilt from the story table, then every agent runs on them, as it would on real data.
- The rebuild stores the day it was built (`instance_settings.demo_as_of`). Every page, view and the assistant age invoices from that day (`private.app_today()`), so the numbers do not shift between the rebuild and midnight.

## What runs differently in demo mode

`DEMO_MODE=true` on the edge functions (`VITE_DEMO_MODE=true` on the frontend). The pipeline is the same; only these differ:

| Part | In the demo |
|---|---|
| News monitor | Reads the seeded fictional articles instead of live news, and classifies them by keywords (no AI call) |
| SEC monitor | Reads seeded fictional filings instead of EDGAR |
| Assistant (CIA) | Answers live with Claude Haiku; **web research is off** (the companies are fictional); a question already asked since the last rebuild is answered from the saved answer |
| Cost limits | 10 questions per visitor per day; live answers stop for the day at 300 answers or about $3 of estimated cost (`CIA_DEMO_DAILY_LIVE_CAP`, `CIA_DEMO_DAILY_USD_CAP`) |
| Sign-in | "Try it as" a credit manager, credit analyst or sales rep; each approves by role, the sales rep only looks around |
| Settings | Read-only, including the Credit Policy (it shows the starting values) |
| New customers (onboarding) | Off; it works on your own install |

Demo rows carry `is_demo = true`. Signed-out visitors can read only because this instance is marked as a public demo (`instance_settings.public_demo`); on any other install they can read nothing.

## How the demo is checked

The **Demo stories** workflow (`.github/workflows/demo-stories.yml`, daily and on pull requests touching functions) builds the demo in a throwaway local install, runs every agent, and checks that each of the 40 customers shows exactly the events and proposal its story expects (`scripts/demo-story-check.mjs`). It needs no API key.

## On your own computer

`scripts/setup-local.sh` starts a local Supabase stack, applies the schema and loads the demo. See the [README](../README.md#run-it-yourself).

## Moving to your own data

Run your own install with `DEMO_MODE=false` and `VITE_DEMO_MODE=false`, and load your customers, invoices and payments (AR aging CSV upload or the onboarding flow). The demo story table is never loaded. Step by step: [RUN_IT_YOURSELF.md](RUN_IT_YOURSELF.md).
