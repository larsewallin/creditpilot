#!/usr/bin/env bash
set -euo pipefail

# scripts/sync-function-secrets.sh prod
#
# Copies the service settings that edge functions read from this shell's
# environment into Supabase function secrets. Only names in the list below,
# only when set and non-empty (an empty one is skipped, never unset). Values
# go through a temporary file (not the command line) and are never printed.
# Used by the Deploy workflow, which reads them from GitHub production-
# environment secrets.

# KEEN_API_KEY / KEEN_API_URL are installed by scripts/connect-keen.sh (Connect Keen workflow), not here.
NAMES=(COMPANY_LOOKUP_URL TCM_API_URL)

ENV="${1:-}"
case "$ENV" in
  prod) TARGET_REF="yxqudytimmxufypothis" ;;
  *) echo "Usage: scripts/sync-function-secrets.sh prod"; exit 1 ;;
esac

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
chmod 600 "$TMP"

SET=()
for n in "${NAMES[@]}"; do
  v="${!n:-}"
  if [ -n "$v" ]; then
    if [[ "$v" == *$'\n'* ]]; then echo "❌ $n contains a newline; skipped."; continue; fi
    printf '%s=%s\n' "$n" "$v" >> "$TMP"
    SET+=("$n")
  fi
done

if [ "${#SET[@]}" -eq 0 ]; then
  echo "No service settings to sync."
  exit 0
fi

YES=()
if [ "${DEPLOY_CONFIRMED:-}" = "1" ]; then YES=(--yes); fi

echo "Setting on $ENV ($TARGET_REF): ${SET[*]}"
supabase secrets set --project-ref "$TARGET_REF" --env-file "$TMP" "${YES[@]}" >/dev/null
echo "✅ Synced ${#SET[@]} setting(s)."
