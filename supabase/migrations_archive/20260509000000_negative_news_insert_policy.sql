-- Add INSERT policy to negative_news.
-- The table has SELECT and UPDATE policies but was missing INSERT,
-- which blocked initDemo() upserts from the frontend (anon role).
CREATE POLICY "Public insert" ON public.negative_news
  FOR INSERT WITH CHECK (true);
