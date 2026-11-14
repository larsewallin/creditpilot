#!/usr/bin/env bash
set -euo pipefail

# scripts/setup-local.sh — run CreditPilot on your own computer, one command.
#
#   scripts/setup-local.sh            the demo: 59 sample customers, agents on Reset Demo
#   scripts/setup-local.sh --empty    no sample data, ready for your own customers
#
# Needs Docker (running) and Node.js 18+. Everything runs locally: a Supabase stack in
# Docker (database, auth, edge functions) and the web app on http://localhost:5173.
# Nothing is sent to any hosted CreditPilot project. Optional keys are read from your
# shell if set: ANTHROPIC_API_KEY (CIA answers, AI tagging), TAVILY_API_KEY (live news),
# KEEN_API_KEY (Keen scores; without it onboarding uses your other score sources).
# Company Lookup and Trade Credit Monitor use their free hosted copies unless
# COMPANY_LOOKUP_URL / TCM_API_URL point somewhere else.
#
# Stop everything with: npx supabase@3.1.0 stop

SUPA="npx --yes supabase@3.1.0"
MODE="demo"
[ "${1:-}" = "--empty" ] && MODE="empty"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

command -v docker >/dev/null || { echo "❌ Docker is not installed: https://docs.docker.com/get-docker/"; exit 1; }
docker info >/dev/null 2>&1 || { echo "❌ Docker is installed but not running. Start Docker Desktop and try again."; exit 1; }
command -v node >/dev/null || { echo "❌ Node.js is not installed: https://nodejs.org (version 18 or newer)"; exit 1; }

say "1/5 Installing packages…"
npm install --no-audit --no-fund --loglevel=error

say "2/5 Starting the local Supabase stack (first run downloads images: a few minutes)…"
$SUPA start -x studio,imgproxy,logflare,vector,supavisor >/dev/null
eval "$($SUPA status -o env | sed 's/^/export LOCAL_/')"
DB_URL="${LOCAL_DB_URL:?could not read the local database address}"
API_URL="${LOCAL_API_URL:?could not read the local API address}"
ANON_KEY="${LOCAL_ANON_KEY:?could not read the local anon key}"
SERVICE_KEY="${LOCAL_SERVICE_ROLE_KEY:?could not read the local service key}"
case "$DB_URL" in *127.0.0.1*|*localhost*) ;; *) echo "❌ Refusing: the database is not local ($DB_URL)"; exit 1 ;; esac
echo "   Database, auth and functions are up (migrations applied)."

if [ "$MODE" = "demo" ]; then
  say "3/5 Loading the demo data (59 fictional customers, invoices, payments, news, filings)…"
  # Marker: a seed customer (migrations alone add only the 23 fixture customers).
  HAS_SEED="$(psql "$DB_URL" -tAc "select count(*) from public.customers where id = 'c0000001-0000-0000-0000-000000000038'" 2>/dev/null || echo 0)"
  if [ "$HAS_SEED" = "0" ]; then
    # pg_dump 18 adds \restrict lines that older psql versions do not know.
    grep -v '^\\\(un\)\?restrict ' supabase/seed.sql | psql "$DB_URL" -q -v ON_ERROR_STOP=1 >/dev/null
    echo "   Loaded $(psql "$DB_URL" -tAc 'select count(*) from public.customers') customers."
  else
    echo "   Already loaded ($(psql "$DB_URL" -tAc 'select count(*) from public.customers') customers)."
  fi
else
  say "3/5 Empty database: no sample data loaded."
fi

say "4/5 Writing local settings…"
DEMO=$([ "$MODE" = "demo" ] && echo true || echo false)
cat > .env.local <<EOF
# Written by scripts/setup-local.sh for the local stack. Not committed.
VITE_SUPABASE_URL=$API_URL
VITE_SUPABASE_PUBLISHABLE_KEY=$ANON_KEY
VITE_DEMO_MODE=$DEMO
EOF
FN_ENV="supabase/functions/.env.local"
umask 077
{
  echo "# Written by scripts/setup-local.sh for the local edge functions. Not committed."
  echo "DEMO_MODE=$DEMO"
  echo "CIA_INTERNAL_TEST_SECRET=local-$(openssl rand -hex 8)"
  echo "SCHEDULER_SECRET=local-$(openssl rand -hex 16)"
  [ -n "${ANTHROPIC_API_KEY:-}" ] && echo "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY"
  [ -n "${TAVILY_API_KEY:-}" ] && echo "TAVILY_API_KEY=$TAVILY_API_KEY"
  [ -n "${KEEN_API_KEY:-}" ] && { echo "KEEN_API_KEY=$KEEN_API_KEY"; echo "KEEN_API_URL=${KEEN_API_URL:-https://keencredit.co/api}"; }
  [ -n "${COMPANY_LOOKUP_URL:-}" ] && echo "COMPANY_LOOKUP_URL=$COMPANY_LOOKUP_URL"
  [ -n "${TCM_API_URL:-}" ] && echo "TCM_API_URL=$TCM_API_URL"
} > "$FN_ENV"
umask 022
echo "   .env.local (web app) and $FN_ENV (functions) written."
[ -z "${ANTHROPIC_API_KEY:-}" ] && echo "   No ANTHROPIC_API_KEY: CIA's questions need one; everything else works."

say "5/5 Creating sign-in accounts…"
SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_KEY" node scripts/create-demo-users.mjs || echo "   (accounts not created; run the line above again later)"

cat <<EOF

✅ CreditPilot is set up ($MODE).

Now run these two commands, each in its own terminal window:

  npx supabase@3.1.0 functions serve --env-file $FN_ENV     # the agents and CIA
  npm run dev                                                # the web app

Then open http://localhost:5173 and sign in with one of the accounts printed above.
$( [ "$MODE" = "demo" ] && echo "Press Reset Demo on the Actions page to run the agents on the sample data." || echo "Upload your AR aging CSV on the AR Aging page; agents run on the schedules in Settings." )

Stop everything later with: npx supabase@3.1.0 stop
EOF
