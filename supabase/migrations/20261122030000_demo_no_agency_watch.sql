-- 20261122030000_demo_no_agency_watch.sql
-- Same statements as the 2026-11-21 block at the end of scripts/demo-third-party-ratings.sql (keep in step).
-- Demo rows only; no row is deleted.

-- 2026-11-21 (migration 20261122030000): CreditPilot does not use agency outlooks or watches
-- (a 3–5 year view, not a short-term trade-credit signal; founder 2026-11-19/20). The demo's
-- Arconic "negative watch" story becomes a payment story, and its notes drop the agency grades.
UPDATE public.negative_news
   SET headline = 'Arconic stretches supplier payments as cash tightens',
       summary  = 'Arconic Corporation has asked several suppliers for longer payment terms as margins weaken and leverage rises. Suppliers report invoices being paid 15 to 30 days later than agreed.',
       category = 'financial_results'
 WHERE is_demo AND headline ~* 'arconic placed on negative watch';

UPDATE public.seed_news
   SET headline = 'Arconic stretches supplier payments as cash tightens',
       summary  = 'Arconic Corporation has asked several suppliers for longer payment terms as margins weaken and leverage rises. Suppliers report invoices being paid 15 to 30 days later than agreed.'
 WHERE headline ~* 'arconic placed on negative watch';

UPDATE public.credit_events
   SET title = replace(title, 'Arconic placed on negative watch', 'Arconic stretches supplier payments as cash tightens'),
       description = 'Arconic Corporation has asked several suppliers for longer payment terms as margins weaken and leverage rises. Suppliers report invoices being paid 15 to 30 days later than agreed.'
 WHERE is_demo AND title ~* 'arconic placed on negative watch';

UPDATE public.customers
   SET notes = 'Covenant waiver obtained Q4 2024. Suppliers report slower payments since early 2025.'
 WHERE public.is_public_demo()
   AND company_name = 'Arconic Corporation'
   AND notes ~ '(B1|Ba3)';
