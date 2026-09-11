UPDATE public.pending_actions
SET rationale = REPLACE(rationale, 'grey-zone Altman Z score and declining', 'concern-range credit score and declining')
WHERE rationale LIKE '%Altman Z%' AND is_demo = true;

UPDATE public.pending_actions
SET rationale = REPLACE(rationale, 'Altman Z', 'credit score')
WHERE rationale LIKE '%Altman Z%' AND is_demo = true;
