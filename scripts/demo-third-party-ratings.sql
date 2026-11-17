-- Demo sample data: no real rating agency or bureau names on invented scores, ratings
-- or news. Every sample score reads "Third-party rating" (provider id "other": a
-- company brings its own provider in Settings › Credit score source).
-- Run by migration 20261117020000 on the hosted demo and by scripts/setup-local.sh
-- after it loads the demo data. Touches demo rows only.
UPDATE public.customers
   SET credit_rating_source = 'other'
 WHERE public.is_public_demo()
   AND credit_rating_source IN ('sp', 'sp_fitch', 'moodys', 'fitch', 'dnb_paydex', 'coface');

UPDATE public.customers
   SET notes = regexp_replace(notes, 'Moody''s|S&P|Fitch', 'Third-party rating', 'g')
 WHERE public.is_public_demo()
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
 WHERE public.is_public_demo()
   AND primary_contact ~ ',';
