-- Demo sample data: no real rating agency or bureau names on invented scores, ratings
-- or news. Every sample score reads "Third-party rating" (provider id "other": a
-- company brings its own provider in Settings › Credit score source).
-- Run by migration 20261117020000 on the hosted demo (as private.is_public_demo(), before
-- 20261117030000 moved it to the private schema) and by scripts/setup-local.sh
-- after it loads the demo data. Touches demo rows only.
UPDATE public.customers
   SET credit_rating_source = 'other'
 WHERE private.is_public_demo()
   AND credit_rating_source IN ('sp', 'sp_fitch', 'moodys', 'fitch', 'dnb_paydex', 'coface');

UPDATE public.customers
   SET notes = regexp_replace(notes, 'Moody''s|S&P|Fitch', 'Third-party rating', 'g')
 WHERE private.is_public_demo()
   AND notes ~ '(Moody''s|S&P|Fitch)';

UPDATE public.credit_events
   SET credit_rating_source = 'other'
 WHERE is_demo AND credit_rating_source IN ('sp', 'sp_fitch', 'moodys', 'fitch', 'dnb_paydex', 'coface');

UPDATE public.credit_events
   SET title = replace(replace(title, ' by Moody''s', ''), ' by S&P', ''),
       description = replace(replace(replace(description, 'Moody''s has placed', 'Its rating agency has placed'), ' by Moody''s', ''), ' by S&P', '')
 WHERE is_demo AND (title ~ '(Moody''s|S&P)' OR description ~ '(Moody''s|S&P)');

UPDATE public.negative_news
   SET headline = replace(headline, ' by Moody''s', ''),
       summary  = replace(summary, 'Moody''s has placed', 'Its rating agency has placed')
 WHERE is_demo AND (headline ~ 'Moody''s' OR summary ~ 'Moody''s');

UPDATE public.seed_news
   SET headline = replace(headline, ' by Moody''s', ''),
       summary  = replace(summary, 'Moody''s has placed', 'Its rating agency has placed')
 WHERE headline ~ 'Moody''s' OR summary ~ 'Moody''s';

UPDATE public.seed_country_risk
   SET rating_agency = 'third_party'
 WHERE rating_agency IN ('sp', 'moodys', 'fitch');

-- Real-looking people's names on invented accounts: keep the role only ("William X, CFO" -> "CFO").
UPDATE public.customers
   SET primary_contact = btrim(regexp_replace(primary_contact, '^[^,]+,\s*', ''))
 WHERE private.is_public_demo()
   AND primary_contact ~ ',';

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
 WHERE private.is_public_demo()
   AND company_name = 'Arconic Corporation'
   AND notes ~ '(B1|Ba3)';

-- 2026-11-21 (migration 20261122040000): demo customers in the starter policy groups, so the
-- demo shows how a group changes the rules (founder, 2026-11-21). Demo rows only.
UPDATE public.customers SET policy_group = 'strategic'
 WHERE private.is_public_demo() AND policy_group IS NULL
   AND company_name IN ('The Boeing Company', 'Lockheed Martin Corporation', 'Raytheon Technologies (RTX)');

UPDATE public.customers SET policy_group = 'export'
 WHERE private.is_public_demo() AND policy_group IS NULL
   AND lifecycle_status = 'active' AND country_code <> 'US';

UPDATE public.customers SET policy_group = 'high_risk'
 WHERE private.is_public_demo() AND policy_group IS NULL
   AND company_name IN ('Brixton Fasteners Ltd', 'Cascade Industrial Systems');
