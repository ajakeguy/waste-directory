-- 015_add_wastedive_source.sql
-- Add Waste Dive as an active news source

INSERT INTO news_sources (name, url, rss_url, category, active)
VALUES (
  'Waste Dive',
  'https://www.wastedive.com',
  'https://www.wastedive.com/feeds/news/',
  'industry_news',
  true
)
ON CONFLICT (rss_url) DO NOTHING;
