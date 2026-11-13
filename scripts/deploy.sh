#!/usr/bin/env bash
set -euo pipefail

# scripts/deploy.sh <function-name> prod            deploy one edge function
# scripts/deploy.sh --delete <function-name> prod   delete one edge function
#
# Every call names the target project explicitly with --project-ref, so the
# result never depends on whatever `supabase link` left behind (backlog E14/E15).
# Works the same on a laptop and in the Deploy workflow (SUPABASE_ACCESS_TOKEN).
# Supabase CLI v3 asks for confirmation before changing a hosted project. On a
# laptop that prompt stays. The Deploy workflow sets DEPLOY_CONFIRMED=1, which
# passes --yes (CI has no terminal to answer the prompt).

ACTION="deploy"
if [ "${1:-}" = "--delete" ]; then
  ACTION="delete"
  shift
fi

FUNCTION="${1:-}"
ENV="${2:-}"

if [ -z "$FUNCTION" ] || [ -z "$ENV" ]; then
  echo "Usage: scripts/deploy.sh [--delete] <function-name> prod"
  exit 1
fi

case "$ENV" in
  staging)
    echo "❌ Staging is paused (2026-10-13). Deploy to prod; bring staging back before real client data."
    exit 1
    ;;
  prod)    TARGET_REF="yxqudytimmxufypothis" ;;
  *)
    echo "❌ Unknown env '$ENV' — must be 'staging' or 'prod'."
    exit 1
    ;;
esac

YES=()
if [ "${DEPLOY_CONFIRMED:-}" = "1" ]; then
  YES=(--yes)
fi

if [ "$ACTION" = "delete" ]; then
  echo "Deleting $FUNCTION from $ENV ($TARGET_REF)..."
  supabase functions delete "$FUNCTION" --project-ref "$TARGET_REF" "${YES[@]}"
  echo "✅ Deleted $FUNCTION from $ENV."
else
  echo "Deploying $FUNCTION to $ENV ($TARGET_REF)..."
  supabase functions deploy "$FUNCTION" --project-ref "$TARGET_REF" "${YES[@]}"
  echo "✅ Deployed $FUNCTION to $ENV."
fi
