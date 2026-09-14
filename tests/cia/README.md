# CIA Test Harness

Regression tests for the Credit Intelligence Agent's question mode.

## Setup

Set environment variables:

    export SUPABASE_URL="https://yxqudytimmxufypothis.supabase.co"
    export SUPABASE_ANON_KEY="<anon key from Supabase dashboard>"
    export CIA_INTERNAL_TEST_SECRET="<value from Supabase Edge Function secrets>"

`CIA_INTERNAL_TEST_SECRET` is optional but strongly recommended: cia-agent enforces a 10-question-per-IP-per-day limit whenever `DEMO_MODE` is true, shared with real visitors on that same IP. Setting it sends a matching `x-internal-test-secret` header that bypasses the limit entirely for this harness, so test runs never eat into or get blocked by that quota, regardless of how many questions the harness or the daily limit grow to.

This must match the `CIA_INTERNAL_TEST_SECRET` value set in Supabase (Dashboard -> Edge Functions -> Manage secrets). If it isn't set there yet, generate one with:

    openssl rand -hex 32

## Run tests

    node tests/cia/run.mjs

Saves results to `tests/cia/results/<timestamp>.json` and prints a summary.

## Compare two runs

    node tests/cia/diff.mjs <baseline.json> <new.json>

Use this before/after any CIA change to see what changed.

## Workflow for CIA changes

1. Run baseline: `node tests/cia/run.mjs`
2. Make the change, deploy
3. Run again: `node tests/cia/run.mjs`
4. Diff: `node tests/cia/diff.mjs <baseline> <new>`
5. If regressions appear, revert or fix before committing
