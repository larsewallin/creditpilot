-- 20261109000000_rename_file_to_keen.sql
--
-- The scoring app "File" is now called "Keen". Renames the stored source id
-- "file" to "keen" in settings and in onboarding records written so far, so old
-- applications show "Keen" and a stored score_order keeps working.
-- credit_events are not touched: events are an append-only record.

UPDATE public.company_settings
SET value = jsonb_set(value, '{score_order}',
      (SELECT jsonb_agg(CASE WHEN e = '"file"'::jsonb THEN '"keen"'::jsonb ELSE e END ORDER BY i)
       FROM jsonb_array_elements(value->'score_order') WITH ORDINALITY AS t(e, i))),
    updated_at = now()
WHERE key = 'onboarding.sources' AND value->'score_order' @> '["file"]'::jsonb;

UPDATE public.score_results SET provider = 'keen' WHERE provider = 'file';

UPDATE public.credit_applications
SET outcome = replace(replace(outcome::text,
      '"provider": "file"', '"provider": "keen"'),
      '"score_source": "file"', '"score_source": "keen"')::jsonb
WHERE outcome::text LIKE '%"file"%';

UPDATE public.pending_actions
SET memo = replace(replace(replace(memo::text,
      'File scoring app', 'Keen'),
      'Bureau / File maximum', 'Bureau / Keen maximum'),
      '"score_source": "file"', '"score_source": "keen"')::jsonb
WHERE memo IS NOT NULL AND memo::text ~ 'File scoring app|Bureau / File|"score_source": "file"';

UPDATE public.underwriting_baseline
SET memo = CASE WHEN memo IS NULL THEN NULL ELSE replace(replace(memo::text,
      'File scoring app', 'Keen'), 'Bureau / File maximum', 'Bureau / Keen maximum')::jsonb END,
    assumptions = replace(assumptions::text, '"score_source": "file"', '"score_source": "keen"')::jsonb
WHERE coalesce(memo::text, '') ~ 'File scoring app|Bureau / File' OR assumptions::text LIKE '%"score_source": "file"%';
