#!/usr/bin/env bash
set -euo pipefail

# scripts/connect-scheduler.sh — gives the agent scheduler a fresh secret that no person sees.
# Run by .github/workflows/connect-scheduler.yml (production environment). Needs:
#   SUPABASE_ACCESS_TOKEN  to set SCHEDULER_SECRET as an edge function secret
#   DATABASE_URL           to store the same value (and project_url) in Supabase Vault for pg_cron
#   SUPABASE_URL           the project's URL (https://<ref>.supabase.co)
# Steps: generate a secret -> function secret -> Vault -> wait for agent-scheduler to be deployed ->
# check it accepts the secret (a dry run: starts nothing). Re-running rotates the secret.

SUPABASE_REF="yxqudytimmxufypothis"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is not set}"
: "${DATABASE_URL:?DATABASE_URL is not set}"
: "${SUPABASE_URL:?SUPABASE_URL is not set}"
[[ "$DATABASE_URL" == *"$SUPABASE_REF"* && "$SUPABASE_URL" == *"$SUPABASE_REF"* ]] || { echo "❌ Not the production project"; exit 1; }

SECRET="$(openssl rand -hex 32)"
echo "::add-mask::$SECRET"

echo "1/4 Setting SCHEDULER_SECRET (Supabase function secret)..."
TMP="$(mktemp)"; chmod 600 "$TMP"; trap 'rm -f "$TMP"' EXIT
printf 'SCHEDULER_SECRET=%s\n' "$SECRET" > "$TMP"
supabase secrets set --project-ref "$SUPABASE_REF" --env-file "$TMP" --yes >/dev/null
echo "   Done."

echo "2/4 Storing scheduler_secret and project_url in Vault..."
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -v s="$SECRET" -v u="${SUPABASE_URL%/}" <<'SQL' >/dev/null
SELECT set_config('cp.scheduler_secret', :'s', false), set_config('cp.project_url', :'u', false);
DO $$
DECLARE sid uuid;
BEGIN
  SELECT id INTO sid FROM vault.secrets WHERE name = 'scheduler_secret';
  IF sid IS NULL THEN PERFORM vault.create_secret(current_setting('cp.scheduler_secret'), 'scheduler_secret');
  ELSE PERFORM vault.update_secret(sid, current_setting('cp.scheduler_secret')); END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'project_url') THEN
    PERFORM vault.create_secret(current_setting('cp.project_url'), 'project_url');
  END IF;
END $$;
SQL
echo "   Done."

echo "3/4 Waiting for agent-scheduler to be deployed..."
CODE=000
for i in $(seq 1 40); do
  CODE="$(curl -sS -o /tmp/sched.json -w '%{http_code}' -X POST "${SUPABASE_URL%/}/functions/v1/agent-scheduler" \
    -H "x-scheduler-secret: $SECRET" -H 'Content-Type: application/json' --data '{"dry_run":true}' || true)"
  [ "$CODE" = 200 ] && break
  sleep 15
done
[ "$CODE" = 200 ] || { echo "❌ agent-scheduler did not accept the secret (HTTP $CODE)"; exit 1; }

echo "4/4 Dry run (starts nothing):"
jq -r '"   mode: \(.mode), time zone: \(.timezone), production would start now: \([.due[].key] | join(", ") | if . == "" then "nothing" else . end)"' /tmp/sched.json
echo "✅ The scheduler is connected. pg_cron calls it every 15 minutes."
