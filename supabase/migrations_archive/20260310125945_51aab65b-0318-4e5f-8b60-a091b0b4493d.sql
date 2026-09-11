
DROP VIEW IF EXISTS public.v_sec_monitoring_dashboard;

CREATE VIEW public.v_sec_monitoring_dashboard AS
SELECT
  sm.id,
  sm.customer_id,
  sm.cik,
  sm.last_10k_date,
  sm.last_10q_date,
  sm.risk_signals,
  sm.alert_triggered,
  sm.created_at,
  sm.ai_risk_score,
  sm.ai_summary,
  c.company_name,
  c.ticker
FROM public.sec_monitoring sm
JOIN public.customers c ON c.id = sm.customer_id;

-- Allow edge function to update sec_monitoring with AI results
CREATE POLICY "Public update sec_monitoring" ON public.sec_monitoring
  FOR UPDATE TO public
  USING (true) WITH CHECK (true);

-- Allow edge function to update sec_filings with AI results  
CREATE POLICY "Public update sec_filings" ON public.sec_filings
  FOR UPDATE TO public
  USING (true) WITH CHECK (true);
