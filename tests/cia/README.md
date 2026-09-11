# CIA Test Harness

Regression tests for the Credit Intelligence Agent's question mode.

## Setup

Set environment variables:

    export SUPABASE_URL="https://yxqudytimmxufypothis.supabase.co"
    export SUPABASE_ANON_KEY="<anon key from Supabase dashboard>"

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
