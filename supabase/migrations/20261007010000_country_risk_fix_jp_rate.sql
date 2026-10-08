-- Fix: Japan seed had policy_rate / previous_policy_rate swapped (hike seeded as a cut).
UPDATE public.seed_country_risk
SET policy_rate = 0.75, previous_policy_rate = 0.25
WHERE country_code = 'JP';
