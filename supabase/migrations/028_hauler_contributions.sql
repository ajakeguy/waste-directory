CREATE TABLE IF NOT EXISTS hauler_service_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contributor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_types text[],
  service_municipalities text[],
  notes text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE hauler_service_contributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own contributions"
  ON hauler_service_contributions FOR ALL
  USING (auth.uid() = contributor_id)
  WITH CHECK (auth.uid() = contributor_id);

CREATE INDEX IF NOT EXISTS hauler_contributions_org_idx
  ON hauler_service_contributions(organization_id);

CREATE INDEX IF NOT EXISTS hauler_contributions_contributor_idx
  ON hauler_service_contributions(contributor_id);
