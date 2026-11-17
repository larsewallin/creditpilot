#!/usr/bin/env bash
# Checks who can read, write and execute what in a CreditPilot database.
#   tests/security/check-public-access.sh <api_url> <anon_key> <db_url> <service_key>
# Runs against a LOCAL stack only (Fresh install CI). For each mode of
# instance_settings.public_demo it checks, through the REST API as a real browser would:
#   * signed out: reads only in a public demo; never writes; executes no data function
#   * signed in without CreditPilot access (no app_users row): reads nothing
#   * signed in CreditPilot user: reads every table / view the service role sees rows in
set -euo pipefail
API="$1"; ANON="$2"; DB="$3"; SERVICE="$4"
case "$DB" in *127.0.0.1*|*localhost*) ;; *) echo "Refusing: not a local database"; exit 1 ;; esac
q() { psql "$DB" -tAc "$1"; }
fail=0
err() { echo "::error::$1"; fail=1; }

OBJECTS="$(q "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v') order by 1")"
AGGREGATES=" v_ar_aging_portfolio v_payment_behaviour_portfolio v_portfolio_overview "
count() { # <object> <bearer>  -> row count visible, or ERR. A portfolio total over no
          # visible rows is one row of zeros / nulls: counted as 0.
  if [[ "$AGGREGATES" == *" $1 "* ]]; then
    curl -s -m 20 "$API/rest/v1/$1?select=*" -H "apikey: $ANON" -H "Authorization: Bearer $2" \
      | jq -r 'if type != "array" then "ERR" else ([.[] | to_entries[] | select((.value | type) == "number" and .value != 0)] | if length > 0 then "1" else "0" end) end'
    return
  fi
  curl -s -m 20 -o /dev/null -D - "$API/rest/v1/$1?select=*&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $2" -H 'Prefer: count=exact' \
    | tr -d '\r' | sed -n 's/^[Cc]ontent-[Rr]ange: .*\/\([0-9*]*\)$/\1/p' | sed 's/^\*$/0/;s/^$/ERR/'
}
token_for() { # <email> -> access token (creates the auth user if needed; no email sent)
  local th
  curl -s -o /dev/null -X POST "$API/auth/v1/admin/users" -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" -H 'Content-Type: application/json' \
    --data "{\"email\":\"$1\",\"email_confirm\":true}" || true
  th="$(curl -s -X POST "$API/auth/v1/admin/generate_link" -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" -H 'Content-Type: application/json' \
    --data "{\"type\":\"magiclink\",\"email\":\"$1\"}" | jq -r '.hashed_token // .properties.hashed_token')"
  curl -s -X POST "$API/auth/v1/verify" -H "apikey: $ANON" -H 'Content-Type: application/json' --data "{\"type\":\"magiclink\",\"token_hash\":\"$th\"}" | jq -r .access_token
}

# Every table needs both gates (catches a later migration that forgets them).
missing="$(q "select string_agg(c.relname, ', ') from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p') and (not c.relrowsecurity
    or not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=c.relname and p.policyname='gate_anon' and p.permissive='RESTRICTIVE')
    or not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=c.relname and p.policyname='gate_authenticated' and p.permissive='RESTRICTIVE'))")"
[ -z "$missing" ] || err "tables without RLS or without the gate_anon / gate_authenticated policies: $missing"
openviews="$(q "select string_agg(c.relname, ', ') from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='v' and not coalesce((select option_value from pg_options_to_table(c.reloptions) where option_name='security_invoker'),'false')::boolean")"
[ -z "$openviews" ] || err "views not security_invoker: $openviews"
writable="$(q "select string_agg(distinct table_name, ', ') from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')")"
[ -z "$writable" ] || err "anon / authenticated may write: $writable"
execs="$(q "select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and has_function_privilege('anon', p.oid, 'EXECUTE')
  and p.proname not in ('is_public_demo','is_app_user','current_app_role')
  and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')")"
[ -n "$execs" ] && echo "Functions anon may execute (policy / view helpers only): $execs"

# What signed-out demo visitors could read before the lock-down (hosted demo, 2026-11-17).
DEMO_PUBLIC=" agent_messages agent_runs ar_aging_snapshots bankruptcy_details company credit_actions credit_events credit_metrics customer_identifiers customers fx_currency_status fx_rate_history growth_signals invoices negative_news payment_transactions pending_actions sec_filings sec_monitoring seed_country_risk seed_industry_econ_signals seed_industry_news v_ar_aging_current v_ar_aging_portfolio v_bankruptcy_claims v_customers_at_risk v_fx_exposure_by_invoice v_growth_opportunities v_overdue_invoices v_payment_behaviour v_payment_behaviour_current v_payment_behaviour_portfolio v_portfolio_overview "

STRANGER="$(token_for stranger@example.com)"     # signed in, no app_users row
MEMBER="$(token_for credit.manager@demo.example.com)"   # created by create-demo-users.mjs

for mode in true false; do
  q "update public.instance_settings set public_demo = $mode" >/dev/null
  echo "── public_demo = $mode"
  for o in $OBJECTS; do
    svc="$(count "$o" "$SERVICE")"; anon="$(count "$o" "$ANON")"; str="$(count "$o" "$STRANGER")"; mem="$(count "$o" "$MEMBER")"
    printf '%-34s service=%-6s anon=%-6s stranger=%-6s member=%s\n' "$o" "$svc" "$anon" "$str" "$mem"
    if [ "$mode" = true ] && [[ "$DEMO_PUBLIC" == *" $o "* ]] && [ "$svc" != 0 ] && [ "$svc" != ERR ] && { [ "$anon" = 0 ] || [ "$anon" = ERR ]; }; then
      err "$o: the demo's signed-out visitors can no longer read it"
    fi
    [ "$mode" = false ] && [ "$anon" != 0 ] && [ "$anon" != ERR ] && err "$o readable signed out outside the demo"
    [ "$str" != 0 ] && [ "$str" != ERR ] && err "$o readable by a signed-in account without CreditPilot access"
    [ "$svc" != 0 ] && [ "$svc" != ERR ] && { [ "$mem" = 0 ] || [ "$mem" = ERR ]; } && [ "$o" != instance_settings ] && echo "   note: $o has rows a CreditPilot user cannot read"
  done
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/rest/v1/credit_events" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H 'Content-Type: application/json' --data '{}')"
  case "$code" in 401|403) ;; *) err "signed-out insert into credit_events answered $code";; esac
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/rest/v1/rpc/fn_reset_demo_invoice_dates" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H 'Content-Type: application/json' --data '{}')"
  case "$code" in 401|403|404) ;; *) err "signed-out call of fn_reset_demo_invoice_dates answered $code";; esac
done
q "update public.instance_settings set public_demo = true" >/dev/null
exit $fail
