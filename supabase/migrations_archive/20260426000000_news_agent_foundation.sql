-- Migration: news agent foundation
-- Adds missing columns to negative_news and deduplication indexes

-- ── negative_news: new columns ───────────────────────────────────────────────

ALTER TABLE public.negative_news
  ADD COLUMN IF NOT EXISTS url                  text,
  ADD COLUMN IF NOT EXISTS content_fingerprint  text,
  ADD COLUMN IF NOT EXISTS is_demo              boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS classification_source text DEFAULT 'keyword',
  ADD COLUMN IF NOT EXISTS confidence           numeric DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS provider             text DEFAULT 'manual';

-- Unique constraint: same article never processed twice.
-- Fingerprint is btoa(customer_id + '|' + normalised_headline + '|' + date).
CREATE UNIQUE INDEX IF NOT EXISTS negative_news_fingerprint_idx
  ON public.negative_news (content_fingerprint)
  WHERE content_fingerprint IS NOT NULL;

-- ── Tag existing rows as demo ─────────────────────────────────────────────────

-- All rows that exist before this migration were seeded for demo purposes.
UPDATE public.negative_news
  SET is_demo = true
  WHERE is_demo = false;
