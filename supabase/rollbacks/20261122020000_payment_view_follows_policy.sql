-- Rollback for 20261122020000_payment_view_follows_policy.sql: re-apply the previous view
-- (supabase/migrations/20261006020000_payment_view_all_time_on_time.sql), then
-- ALTER VIEW public.v_payment_behaviour_current SET (security_invoker = true);
-- No data is changed either way: this is a view.
\i supabase/migrations/20261006020000_payment_view_all_time_on_time.sql
ALTER VIEW public.v_payment_behaviour_current SET (security_invoker = true);
