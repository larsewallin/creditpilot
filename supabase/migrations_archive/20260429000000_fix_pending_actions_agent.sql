-- Fix 1: Credit limit reduction actions were written by ar_aging_agent during
-- early development; CIA agent now owns these decisions.
UPDATE public.pending_actions
SET agent_name = 'cia-agent'
WHERE agent_name = 'ar_aging_agent'
  AND is_demo = true
  AND action_type = 'CREDIT_LIMIT_REDUCTION';

-- Fix 2: Remove duplicate negative_news rows from pre-deduplication test runs,
-- keeping only the most recent row per (customer_id, headline) pair.
DELETE FROM public.negative_news
WHERE id NOT IN (
  SELECT DISTINCT ON (customer_id, headline) id
  FROM public.negative_news
  ORDER BY customer_id, headline, created_at DESC
)
AND is_demo = true;
