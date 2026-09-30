#!/usr/bin/env bash
set -euo pipefail

FILE="${1:-}"
MODE="${2:-}"

if [ -z "$FILE" ]; then
  echo "Usage: scripts/migrate.sh <file.sql> [--apply]"
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL not set — run: usedb staging   OR   usedb prod"
  exit 1
fi

if grep -qiE '^\s*(BEGIN|COMMIT|ROLLBACK)\s*;' "$FILE"; then
  echo "❌ $FILE contains its own BEGIN/COMMIT/ROLLBACK."
  echo "   Migration files must NOT manage their own transaction —"
  echo "   this script wraps it, and an embedded COMMIT defeats dry-run."
  echo "   Remove those lines from the file and try again."
  exit 1
fi

echo "Target: $(echo "$DATABASE_URL" | sed -E 's/:[^:@]+@/:***@/')"

if [ "$MODE" = "--apply" ]; then
  echo "⚠️  APPLYING FOR REAL in 3s — Ctrl+C to cancel"
  sleep 3
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "BEGIN;" -f "$FILE" -c "COMMIT;"
  echo "✅ Applied."
else
  echo "Dry run..."
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "BEGIN;" -f "$FILE" -c "ROLLBACK;"
  echo "✅ Dry run complete — nothing committed."
fi
