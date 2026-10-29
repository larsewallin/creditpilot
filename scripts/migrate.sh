#!/usr/bin/env bash
set -euo pipefail

FILE="${1:-}"
MODE="${2:-}"

if [ -z "$FILE" ]; then
  echo "Usage: scripts/migrate.sh <file.sql> [--apply]"
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL not set — run this via: npm run db:prod -- scripts/migrate.sh ..."
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
  # Single-environment setup (staging paused 2026-10-13): every apply lands on the
  # live project, so a backup of the public schema (structure + data) is taken first.
  # If the backup cannot be made, nothing is applied.
  mkdir -p backups
  BACKUP="backups/$(date +%Y%m%d-%H%M%S)-before-$(basename "$FILE" .sql).sql"
  echo "Backing up public schema to $BACKUP ..."
  if ! pg_dump "$DATABASE_URL" --schema=public --no-owner --no-privileges -f "$BACKUP"; then
    rm -f "$BACKUP"
    echo "❌ Backup failed, so nothing was applied."
    echo "   If pg_dump reports a server version mismatch: brew install postgresql@17"
    echo "   and put it first on your PATH, then run this again."
    exit 1
  fi
  echo "✅ Backup saved ($(du -h "$BACKUP" | cut -f1))."
  echo "⚠️  APPLYING FOR REAL in 3s — Ctrl+C to cancel"
  sleep 3
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "BEGIN;" -f "$FILE" -c "COMMIT;"
  echo "✅ Applied."
else
  echo "Dry run..."
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "BEGIN;" -f "$FILE" -c "ROLLBACK;"
  echo "✅ Dry run complete — nothing committed."
fi
