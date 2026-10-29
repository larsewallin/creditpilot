#!/usr/bin/env bash
set -euo pipefail

# scripts/with-env.sh production -- <command...>
#
# Replaces `usedb prod && <command>` from the old ~/.zshrc workflow (retired
# 2026-10-14 — see CLAUDE.md). Loads .env.production (gitignored, repo-local
# only — never committed) into THIS invocation only, then execs the given
# command so it inherits those vars. Nothing persists past the command exiting
# — there is no shell-session equivalent of `usedb`; env vars can't be
# exported back into whatever shell called this script, only into the
# subprocess tree it starts. For a one-off command (a migration, a script,
# a psql check) that's exactly what's needed; see CLAUDE.md for the one-line
# `source .env.production` alternative if you ever need several commands in
# a row against prod in the same interactive shell.
#
# Guard: refuses to run unless SUPABASE_URL's project ref is the production
# ref AND DATABASE_URL contains that same ref. This is what stands in for the
# old PROD_*/STAGING_* naming split now that only one env file exists — if
# .env.production is ever edited by hand into something pointing anywhere
# else, this catches it before anything executes, not after.

PROD_REF="yxqudytimmxufypothis"

ENV_NAME="${1:-}"
if [ "$ENV_NAME" != "production" ]; then
  echo "Usage: scripts/with-env.sh production -- <command...>" >&2
  exit 1
fi
shift
if [ "${1:-}" = "--" ]; then
  shift
fi
if [ "$#" -eq 0 ]; then
  echo "No command given. Usage: scripts/with-env.sh production -- <command...>" >&2
  exit 1
fi

ENV_FILE=".env.production"
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ $ENV_FILE not found. See CLAUDE.md for how to create it." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [[ "${SUPABASE_URL:-}" != *"$PROD_REF"* ]]; then
  echo "❌ Refusing to run: SUPABASE_URL in $ENV_FILE does not match the production project ref ($PROD_REF)." >&2
  echo "   Nothing was executed." >&2
  exit 1
fi

if [[ "${DATABASE_URL:-}" != *"$PROD_REF"* ]]; then
  echo "❌ Refusing to run: DATABASE_URL in $ENV_FILE does not match the production project ref ($PROD_REF)." >&2
  echo "   Nothing was executed." >&2
  exit 1
fi

echo "🔴🔴🔴 RUNNING AGAINST PRODUCTION (ref: $PROD_REF) 🔴🔴🔴" >&2

exec "$@"
