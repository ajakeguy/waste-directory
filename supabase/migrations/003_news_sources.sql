-- 003_news_sources.sql
-- Seed the five industry news RSS sources

insert into news_sources (name, url, rss_url, category, active) values
(
  'Waste360',
  'https://www.waste360.com',
  'https://www.waste360.com/rss.xml',
  'industry',
  true
),
(
  'Resource Recycling',
  'https://resource-recycling.com',
  'https://resource-recycling.com/feed',
  'recycling',
  true
),
(
  'BioCycle',
  'https://www.biocycle.net',
  'https://www.biocycle.net/feed/',
  'composting',
  true
),
(
  'Recycling Today',
  'https://www.recyclingtoday.com',
  'https://www.recyclingtoday.com/rss/',
  'recycling',
  true
),
(
  'WasteAdvantage',
  'https://wasteadvantagemag.com',
  'https://wasteadvantagemag.com/feed/',
  'industry',
  true
)
on conflict (rss_url) do nothing;
