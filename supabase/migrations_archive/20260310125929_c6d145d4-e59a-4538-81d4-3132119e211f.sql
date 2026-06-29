
ALTER TABLE public.sec_monitoring
  ADD COLUMN IF NOT EXISTS ai_risk_score integer,
  ADD COLUMN IF NOT EXISTS ai_summary text;
