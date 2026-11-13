#!/usr/bin/env bash
set -euo pipefail

# scripts/connect-keen.sh — connects CreditPilot to Keen with a fresh API key that no person sees.
# Run by .github/workflows/connect-keen.yml (production environment). Needs:
#   VERCEL_TOKEN           to set KEEN_API_KEYS on Keen's Vercel project and redeploy it
#   SUPABASE_ACCESS_TOKEN  to set KEEN_API_KEY / KEEN_API_URL as CreditPilot function secrets
# Steps: generate a key -> set it on Keen (Vercel, Production, sensitive) -> redeploy Keen and wait ->
# set it in CreditPilot's Supabase -> check Keen answers a scored request. Re-running rotates the key.
# The key is masked in the log and never printed.

VERCEL_TEAM="team_u4YSsSEq1LnhqFb7nvEEo7Vr"
KEEN_PROJECT="prj_VWZiMGhMWoW3c8ORf5hHQd3JoGfS"   # Vercel project "file-credit" (Keen)
KEEN_URL="https://keencredit.co/api"
SUPABASE_REF="yxqudytimmxufypothis"
API="https://api.vercel.com"

: "${VERCEL_TOKEN:?VERCEL_TOKEN is not set on the production environment}"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is not set}"

KEY="$(openssl rand -hex 32)"
echo "::add-mask::$KEY"
AUTH=(-H "Authorization: Bearer $VERCEL_TOKEN")

echo "1/5 Setting KEEN_API_KEYS on Keen (Vercel, Production)..."
BODY="$(jq -n --arg v "$KEY" '{key:"KEEN_API_KEYS", value:$v, type:"sensitive", target:["production"]}')"
CODE="$(curl -sS -o /tmp/env.json -w '%{http_code}' "${AUTH[@]}" -H 'Content-Type: application/json' \
  -X POST "$API/v10/projects/$KEEN_PROJECT/env?upsert=true&teamId=$VERCEL_TEAM" --data "$BODY")"
[ "$CODE" = 200 ] || [ "$CODE" = 201 ] || { echo "❌ Vercel env update failed (HTTP $CODE): $(jq -c '.error // .' /tmp/env.json)"; exit 1; }

echo "2/5 Redeploying Keen production..."
LATEST="$(curl -sS "${AUTH[@]}" "$API/v6/deployments?projectId=$KEEN_PROJECT&target=production&state=READY&limit=1&teamId=$VERCEL_TEAM" | jq -r '.deployments[0].uid // empty')"
[ -n "$LATEST" ] || { echo "❌ No ready production deployment found for Keen"; exit 1; }
NEW="$(curl -sS "${AUTH[@]}" -H 'Content-Type: application/json' -X POST "$API/v13/deployments?teamId=$VERCEL_TEAM&forceNew=1" \
  --data "$(jq -n --arg d "$LATEST" '{name:"file-credit", deploymentId:$d, target:"production"}')" | jq -r '.id // empty')"
[ -n "$NEW" ] || { echo "❌ Redeploy request failed"; exit 1; }
for i in $(seq 1 60); do
  STATE="$(curl -sS "${AUTH[@]}" "$API/v13/deployments/$NEW?teamId=$VERCEL_TEAM" | jq -r '.readyState // .status // "UNKNOWN"')"
  [ "$STATE" = READY ] && break
  case "$STATE" in ERROR|CANCELED) echo "❌ Keen redeploy ended in $STATE"; exit 1 ;; esac
  sleep 10
done
[ "$STATE" = READY ] || { echo "❌ Keen redeploy not ready after 10 minutes"; exit 1; }
echo "   Keen redeployed ($NEW)."

echo "3/5 Setting KEEN_API_KEY and KEEN_API_URL in CreditPilot (Supabase)..."
TMP="$(mktemp)"; chmod 600 "$TMP"; trap 'rm -f "$TMP"' EXIT
printf 'KEEN_API_KEY=%s\nKEEN_API_URL=%s\n' "$KEY" "$KEEN_URL" > "$TMP"
supabase secrets set --project-ref "$SUPABASE_REF" --env-file "$TMP" --yes >/dev/null
echo "   Done."

echo "4/5 Checking Keen answers (ticker AAPL)..."
sleep 20   # let the production domain move to the new deployment
for i in 1 2 3 4 5 6; do
  CODE="$(curl -sS -o /tmp/score.json -w '%{http_code}' -X POST "$KEEN_URL/v1/score" \
    -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' --data '{"request_id":"connect-keen-check","company":{"ticker":"AAPL"}}')"
  [ "$CODE" = 200 ] && break
  sleep 15
done
if [ "$CODE" = 200 ]; then
  echo "   Keen answered 200: $(jq -c '{score, label, model_version, as_of, company: .company.name}' /tmp/score.json)"
else
  echo "❌ Keen answered HTTP $CODE: $(jq -c '{error, reason, message}' /tmp/score.json 2>/dev/null || head -c 200 /tmp/score.json)"
  exit 1
fi

echo "5/5 Checking a request without the key is refused..."
CODE="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$KEEN_URL/v1/score" -H 'Content-Type: application/json' --data '{"company":{"ticker":"AAPL"}}')"
[ "$CODE" = 401 ] || { echo "❌ Expected 401 without a key, got $CODE"; exit 1; }
echo "✅ CreditPilot is connected to Keen."
