#!/usr/bin/env bash
set -euo pipefail

if [ -z "${STAGING_DATABASE_URL:-}" ] || [ -z "${PROD_DATABASE_URL:-}" ]; then
  echo "This script compares staging vs prod schema, but staging was retired"
  echo "2026-10-14 along with its credentials (see CLAUDE.md, 'Environment"
  echo "variables'). It has no two-environment target to diff against until"
  echo "staging comes back; it cannot be made to work by re-exporting these"
  echo "two vars yourself."
  exit 1
fi

OUT="${TMPDIR:-/tmp}/creditpilot-schema-diff"
mkdir -p "$OUT"

dump() {
  local url="$1" file="$2"
  {
    echo "## columns"
    psql "$url" -At -F ' | ' -c "
      select table_name, column_name, data_type, is_nullable, coalesce(column_default,'')
      from information_schema.columns
      where table_schema='public'
      order by table_name, column_name"
    echo "## constraints"
    psql "$url" -At -F ' | ' -c "
      select c.relname, con.conname, pg_get_constraintdef(con.oid)
      from pg_constraint con
      join pg_class c on c.oid=con.conrelid
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public'
      order by 1,2"
    echo "## indexes"
    psql "$url" -At -F ' | ' -c "
      select tablename, indexname, indexdef from pg_indexes
      where schemaname='public' order by 1,2"
    echo "## policies"
    psql "$url" -At -F ' | ' -c "
      select tablename, policyname, cmd, roles::text, coalesce(qual,''), coalesce(with_check,'')
      from pg_policies where schemaname='public' order by 1,2"
    echo "## rls"
    psql "$url" -At -F ' | ' -c "
      select c.relname, c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' order by 1"
    echo "## views"
    psql "$url" -At -F ' | ' -c "
      select viewname, md5(definition) from pg_views where schemaname='public' order by 1"
    echo "## functions"
    psql "$url" -At -F ' | ' -c "
      select p.proname, pg_get_function_identity_arguments(p.oid), md5(p.prosrc)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' order by 1,2"
    echo "## triggers"
    psql "$url" -At -F ' | ' -c "
      select c.relname, t.tgname, md5(pg_get_triggerdef(t.oid))
      from pg_trigger t join pg_class c on c.oid=t.tgrelid
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and not t.tgisinternal order by 1,2"
  } > "$file"
}

echo "Reading staging..."
dump "$STAGING_DATABASE_URL" "$OUT/staging.txt"
echo "Reading prod..."
dump "$PROD_DATABASE_URL" "$OUT/prod.txt"

if diff -u "$OUT/staging.txt" "$OUT/prod.txt" > "$OUT/diff.txt"; then
  echo "✅ Staging and prod schemas match."
else
  echo "⚠️  Differences (--- staging, +++ prod):"
  cat "$OUT/diff.txt"
  exit 2
fi
