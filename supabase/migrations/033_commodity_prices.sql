-- Migration 033: Commodity pricing dashboard tables

-- Main price time-series table (fetched from EIA/FRED)
CREATE TABLE commodity_prices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_key text NOT NULL,
  price         numeric NOT NULL,
  unit          text NOT NULL,
  period_date   date NOT NULL,
  source        text NOT NULL,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (commodity_key, period_date)
);

CREATE INDEX commodity_prices_key_date_idx
  ON commodity_prices (commodity_key, period_date DESC);

ALTER TABLE commodity_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read commodity prices"
  ON commodity_prices FOR SELECT USING (true);

-- Community price contributions (for SMP / manually-sourced commodities)
CREATE TABLE commodity_price_contributions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_key      text NOT NULL,
  price              numeric NOT NULL,
  unit               text NOT NULL,
  region             text,
  source_description text,
  contributor_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz DEFAULT now()
);

ALTER TABLE commodity_price_contributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can contribute prices"
  ON commodity_price_contributions FOR INSERT WITH CHECK (true);

CREATE POLICY "Users see own contributions"
  ON commodity_price_contributions FOR SELECT
  USING (auth.uid() = contributor_id OR contributor_id IS NULL);
