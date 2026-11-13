#!/usr/bin/env bash
set -euo pipefail

# scripts/migrate.sh <file.sql> [<file.sql> ...] [--apply]
#
# Dry run by default: every file runs inside ONE transaction that is rolled back.
# With --apply: backs up the public schema first, then applies every file inside
# ONE transaction (all or nothing). Several files are run together so a later
# migration can depend on an earlier one, in the order given.
#
# BACKUP_DIR (optional) sets where the backup goes (default: backups/).
# MIGRATE_NO_DELAY=1 skips the 3-second cancel window (used by the Deploy workflow).

MODE=""
FILES=()
for arg in "$@"; do
  if [ "$arg" = "--apply" ]; then MODE="--apply"; else FILES+=("$arg"); fi
done

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "Usage: scripts/migrate.sh <file.sql> [<file.sql> ...] [--apply]"
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL not set — run this via: npm run db:prod -- scripts/migrate.sh ..."
  exit 1
fi

PSQL_ARGS=(-c "BEGIN;")
for f in "${FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "❌ $f not found."
    exit 1
  fi
  if grep -qiE '^\s*(BEGIN|COMMIT|ROLLBACK)\s*;' "$f"; then
    echo "❌ $f contains its own BEGIN/COMMIT/ROLLBACK."
    echo "   Migration files must NOT manage their own transaction —"
    echo "   this script wraps it, and an embedded COMMIT defeats dry-run."
    echo "   Remove those lines from the file and try again."
    exit 1
  fi
  PSQL_ARGS+=(-f "$f")
done

echo "Target: $(echo "$DATABASE_URL" | sed -E 's/:[^:@]+@/:***@/')"
echo "Files:"; printf '  %s\n' "${FILES[@]}"

if [ "$MODE" = "--apply" ]; then
  # Single-environment setup (staging paused 2026-10-13): every apply lands on the
  # live project, so a backup of the public schema (structure + data) is taken first.
  # If the backup cannot be made, nothing is applied.
  BACKUP_DIR="${BACKUP_DIR:-backups}"
  mkdir -p "$BACKUP_DIR"
  BACKUP="$BACKUP_DIR/$(date +%Y%m%d-%H%M%S)-before-$(basename "${FILES[0]}" .sql).sql"
  echo "Backing up public schema to $BACKUP ..."
  if ! pg_dump "$DATABASE_URL" --schema=public --no-owner --no-privileges -f "$BACKUP"; then
    rm -f "$BACKUP"
    echo "❌ Backup failed, so nothing was applied."
    echo "   If pg_dump reports a server version mismatch: brew install postgresql@17"
    echo "   and put it first on your PATH, then run this again."
    exit 1
  fi
  echo "✅ Backup saved ($(du -h "$BACKUP" | cut -f1))."
  if [ "${MIGRATE_NO_DELAY:-}" != "1" ]; then
    echo "⚠️  APPLYING FOR REAL in 3s — Ctrl+C to cancel"
    sleep 3
  fi
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 "${PSQL_ARGS[@]}" -c "COMMIT;"
  echo "✅ Applied."
else
  echo "Dry run..."
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 "${PSQL_ARGS[@]}" -c "ROLLBACK;"
  echo "✅ Dry run complete — nothing committed."
fi
