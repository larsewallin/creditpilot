
-- Fix views to use SECURITY INVOKER
ALTER VIEW public.v_ar_aging_current SET (security_invoker = on);
ALTER VIEW public.v_ar_aging_portfolio SET (security_invoker = on);
ALTER VIEW public.v_overdue_invoices SET (security_invoker = on);
ALTER VIEW public.v_payment_behaviour SET (security_invoker = on);
ALTER VIEW public.v_customers_at_risk SET (security_invoker = on);
ALTER VIEW public.v_sec_monitoring_dashboard SET (security_invoker = on);
