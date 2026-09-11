-- Adds a real link from a NEWS_EVENT credit_events row back to the exact
-- negative_news article it came from, so Credit Events cards and other UI
-- can navigate to the specific source article instead of the generic
-- News Monitor archive. Wired into publishEvent and news-monitor-agent
-- (both the live pipeline and legacyPath) in the same session.

ALTER TABLE credit_events ADD COLUMN IF NOT EXISTS negative_news_id uuid REFERENCES negative_news(id) ON DELETE SET NULL;
