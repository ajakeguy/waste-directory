-- Migration 030: User-submitted contact cards for haulers and disposal facilities
CREATE TABLE IF NOT EXISTS user_submitted_contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     text NOT NULL CHECK (entity_type IN ('hauler', 'facility')),
  entity_id       uuid NOT NULL,
  contributor_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_name    text,
  contact_title   text,
  contact_email   text,
  contact_phone   text,
  contact_type    text DEFAULT 'general' CHECK (contact_type IN ('general', 'billing', 'operations', 'sales', 'emergency')),
  notes           text,
  status          text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE user_submitted_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own contact submissions"
  ON user_submitted_contacts FOR ALL
  USING  (auth.uid() = contributor_id)
  WITH CHECK (auth.uid() = contributor_id);

-- Allow reading approved contacts without auth (for public profiles)
CREATE POLICY "Anyone can read approved contacts"
  ON user_submitted_contacts FOR SELECT
  USING (status = 'approved');

-- Index for fast lookups by entity
CREATE INDEX IF NOT EXISTS user_submitted_contacts_entity_idx
  ON user_submitted_contacts (entity_type, entity_id, status);
