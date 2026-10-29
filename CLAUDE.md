# CreditPilot — Engineering Principles

This file is read automatically at the start of every Claude Code session in this repo.
It holds durable engineering principles discovered the hard way — not a status log
(see docs/CreditPilot_Deferred_Backlog.md for that) — just rules worth never re-learning.

## Never let an LLM compute exact arithmetic over multiple records

If a question requires summing, averaging, or otherwise aggregating numeric values across
more than one raw database record, the LLM must never be asked to do that math itself —
even with a careful prompt. This is a well-documented, measured limitation of language
models, not a prompting problem to engineer around.

Confirmed directly in this project (2026-08-29): the CIA agent was caught red-handed
producing three different portfolio totals across three identical requests, off by
millions of dollars, because it was handed raw line items and asked to sum them itself.

**The rule:** if a question needs an aggregate figure, compute it deterministically —
a SQL view, an RPC, or a simple JS reduce() over already-fetched rows — and hand the
model the finished number as an authoritative fact. The model's job is explaining and
contextualizing correct numbers, never generating them through its own arithmetic.

This applies to every future agent, field, or feature added to this project. Before
wiring any new data into a prompt, ask: "does this involve the model summing/averaging/
counting more than a couple of raw records?" If yes, pre-compute it first.

Reference implementation: supabase/functions/cia-agent/index.ts — search for
"OFFICIAL AR AGING PORTFOLIO TOTALS", "OFFICIAL SECTOR EXPOSURE TOTAL", "OFFICIAL
COMBINED TOTAL", "OFFICIAL PAYMENT BEHAVIOR TOTALS" for the pattern to copy.

## Never print credential values

If checking whether an environment variable is set (DATABASE_URL, API keys, any
credential), only ever show the variable NAME, never its value -- e.g.
`env | grep -i database | cut -d= -f1`, never a bare `env | grep`. Postgres connection
strings embed the password directly in the URL, so printing the full line exposes it.
If a credential is ever accidentally displayed anyway, flag it immediately and
recommend rotation right away -- don't wait to be asked.

Found the hard way: an `env | grep` command printed a live DATABASE_URL, including
its password, into a session transcript on 2026-09-03. The founder rotated the
credential afterward.

## Always deploy and migrate through scripts/deploy.sh and scripts/migrate.sh — never bare supabase/psql commands

`scripts/deploy.sh <function> staging|prod` and `scripts/migrate.sh <file.sql> [--apply]`
exist specifically so a bare `supabase functions deploy`, `supabase db push`, or `psql
"$DATABASE_URL" -f ...` can never silently land on the wrong project. `deploy.sh` links
explicitly around each deploy (staging is currently paused — see "Staging must match
production" below — so `deploy.sh staging` refuses outright rather than relinking
anywhere); `migrate.sh` requires `DATABASE_URL` to be set, prints the (password-masked)
target before running, refuses any migration file containing its own
`BEGIN`/`COMMIT`/`ROLLBACK` (that defeats its dry-run), and defaults to a dry run unless
`--apply` is passed. See "Environment variables" below for how `DATABASE_URL` gets set now.

**The rule:** every function deploy and every migration apply/dry-run goes through these
two scripts. Never run `supabase functions deploy`, `supabase db push`, `supabase link`,
or a raw `psql "$DATABASE_URL" -f <migration>` directly — even for "just checking," even
mid-diagnosis. If a task needs a one-off read-only query, that's fine raw; anything that
applies schema or deploys code goes through the scripts.

## Staging must match production

**Currently paused (2026-10-13):** staging is not in use — `deploy.sh staging` refuses, and its credentials were removed from `~/.zshrc` on 2026-10-14 (see "Environment variables" below). `scripts/diff-schema.sh` has no second environment to diff against until staging is restored; every migration today goes to prod only. The policy below is what resumes once staging comes back, not what to follow in the meantime.

Every migration is applied to staging AND prod, in the same session, before the work is called done. After any migration, run `scripts/diff-schema.sh` (read-only; compares columns, constraints, indexes, policies, views, functions and triggers on both). Any difference is a defect to fix, not to note. Origin: 2026-10-09, the F6 `pending_actions` columns existed on prod but not on staging.

Found the hard way (2026-10-01/10-02): F4 and F5 (and 7 pending migrations) were deployed
using bare `supabase functions deploy` / `supabase db push --dry-run` commands instead of
these scripts. Both landed on `mwyezrnolctipbcwqubg` ("creditpilot-staging") — the CLI's
resting-state link — while the live app runs on `yxqudytimmxufypothis`. The mistake went
undetected through a full "ship and verify" cycle (tests passed, functions deployed
without error, migrations applied without error) because nothing failed — it just quietly
changed the wrong database. Caught only because the user noticed the Payments page still
looked wrong after everything "succeeded." Had to redo every step on the correct project
once the mismatch was found. Costly specifically because it was invisible, not because any
single command errored.

## Environment variables live in .env.production, never ~/.zshrc

(as of 2026-10-14) CreditPilot's production credentials live in `.env.production` in
this repo's root — gitignored, never committed. They are deliberately **not** in
`~/.zshrc` — that file is shared by every project on this Mac, and a secret sitting
there is visible to all of them, not just this repo.

`.env.production` holds `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DATABASE_URL`,
`CIA_INTERNAL_TEST_SECRET` — the production values (the old `~/.zshrc` kept the
unprefixed names pointed at staging and the real production values under a `PROD_`
prefix; `.env.production` is production-only, so it uses the plain names directly).

`SUPABASE_SERVICE_ROLE_KEY` is deliberately **not** in this file. The key that was in
`~/.zshrc` is Supabase's newer non-JWT `sb_secret_...` format, which (unlike a JWT) has
no embedded `ref` claim — there was no way to confirm which project it belonged to
without calling the Supabase Management API, so it was left out rather than guessed.
If a script ever needs it, get it fresh from the Supabase dashboard for the
`yxqudytimmxufypothis` project specifically, confirm that before adding it, and add it
as a new line in `.env.production` (still gitignored).

**To run any command against production:**

```
npm run db:prod -- <command>
```

e.g. `npm run db:prod -- node tests/cia/run.mjs`, or
`npm run db:prod -- scripts/migrate.sh supabase/migrations/some_file.sql --apply`.

This is the full replacement for the old `usedb prod` zshrc function. Under the hood it
runs `scripts/with-env.sh production -- <command>`, which:
- sources `.env.production` into that one command's process tree only (nothing persists
  after the command exits — there is no shell-session equivalent of `usedb`, since a
  script can't export variables back into whatever shell called it)
- refuses to run at all, before executing anything, unless `SUPABASE_URL` *and*
  `DATABASE_URL` both contain the production project ref (`yxqudytimmxufypothis`) —
  if `.env.production` is ever hand-edited into pointing somewhere else, this is what
  catches it
- prints a loud `RUNNING AGAINST PRODUCTION` banner first

If several prod commands are needed in a row in the same interactive terminal (rare —
most tasks are one command), `set -a; source .env.production; set +a` once accomplishes
the same thing `usedb prod` used to, for that terminal session only.

Local frontend dev (`npm run dev`) is unaffected by any of this: Vite auto-loads `.env`
(anon-level `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` / `VITE_DEMO_MODE`
only), which was never in `~/.zshrc` and needs no wrapper.
