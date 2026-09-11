-- Tag all existing agent_messages and credit_events as demo
-- We have no real production data yet, so everything is demo data

UPDATE public.agent_messages SET is_demo = true WHERE is_demo = false;
UPDATE public.credit_events  SET is_demo = true WHERE is_demo = false;
