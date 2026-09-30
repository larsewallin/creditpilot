#!/usr/bin/env bash
set -euo pipefail

FUNCTION="${1:-}"
ENV="${2:-}"

if [ -z "$FUNCTION" ] || [ -z "$ENV" ]; then
  echo "Usage: scripts/deploy.sh <function-name> staging|prod"
  exit 1
fi

case "$ENV" in
  staging) TARGET_REF="mwyezrnolctipbcwqubg" ;;
  prod)    TARGET_REF="yxqudytimmxufypothis" ;;
  *)
    echo "❌ Unknown env '$ENV' — must be 'staging' or 'prod'."
    exit 1
    ;;
esac

# supabase functions deploy targets whatever project is currently `supabase
# link`-ed, which is independent of usedb/DATABASE_URL/SUPABASE_URL — those
# don't influence the CLI's deploy target at all. This script owns the link
# explicitly around the deploy instead of trusting whatever was left linked
# by a prior command (see backlog E14).
echo "Linking to $ENV ($TARGET_REF)..."
supabase link --project-ref "$TARGET_REF"

echo "Deploying $FUNCTION to $ENV..."
supabase functions deploy "$FUNCTION"

# Always return to staging as the safe resting state, mirroring the bare-env-var
# convention (usedb/DATABASE_URL default to staging too).
echo "Relinking to staging (safe default)..."
supabase link --project-ref mwyezrnolctipbcwqubg

echo "✅ Deployed $FUNCTION to $ENV, relinked to staging."
