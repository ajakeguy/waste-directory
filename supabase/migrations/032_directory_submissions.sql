-- Migration 032: User-submitted directory listings (missing haulers / facilities)
CREATE TABLE IF NOT EXISTS directory_submissions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_type text NOT NULL CHECK (submission_type IN ('hauler', 'facility')),
  contributor_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Common fields
  company_name    text NOT NULL,
  address         text,
  city            text,
  state           text,
  zip             text,
  phone           text,
  email           text,
  website         text,
  -- Hauler-specific
  service_types   text[],
  service_states  text[],
  license_number  text,
  -- Facility-specific
  facility_type   text,
  accepted_materials text[],
  -- Meta
  notes           text,
  status          text DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'added', 'rejected')),
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE directory_submissions ENABLE ROW LEVEL SECURITY;

-- Anyone can submit; authenticated users can also read their own submissions
CREATE POLICY "Anyone can submit directory entries"
  ON directory_submissions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can read own submissions"
  ON directory_submissions FOR SELECT
  USING (contributor_id IS NULL OR auth.uid() = contributor_id);

CREATE INDEX IF NOT EXISTS directory_submissions_contributor_idx
  ON directory_submissions (contributor_id, created_at DESC);
