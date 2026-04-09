-- Migration 024: saved_disposal_facilities table
-- Lets authenticated users bookmark disposal facility pages.

CREATE TABLE saved_disposal_facilities (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  facility_id uuid        NOT NULL REFERENCES disposal_facilities(id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, facility_id)
);

ALTER TABLE saved_disposal_facilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own saved facilities"
  ON saved_disposal_facilities FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
