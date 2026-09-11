-- Add is_demo to negative_news so frontend queries can filter demo vs live data
ALTER TABLE public.negative_news
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

-- Tag all existing rows as demo since we have no real production data yet
UPDATE public.negative_news SET is_demo = true WHERE is_demo = false;
