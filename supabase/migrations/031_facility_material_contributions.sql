-- Migration 031: User-contributed disposal facility materials
CREATE TABLE IF NOT EXISTS facility_material_contributions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id           uuid NOT NULL REFERENCES disposal_facilities(id) ON DELETE CASCADE,
  contributor_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  material_codes        text[],
  material_descriptions text[],
  notes                 text,
  status                text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at            timestamptz DEFAULT now()
);

ALTER TABLE facility_material_contributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own material contributions"
  ON facility_material_contributions FOR ALL
  USING  (auth.uid() = contributor_id)
  WITH CHECK (auth.uid() = contributor_id);

-- Allow reading approved contributions without auth
CREATE POLICY "Anyone can read approved material contributions"
  ON facility_material_contributions FOR SELECT
  USING (status = 'approved');

CREATE INDEX IF NOT EXISTS facility_material_contributions_facility_idx
  ON facility_material_contributions (facility_id, status);
