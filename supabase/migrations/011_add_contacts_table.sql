-- Migration 011: Add contacts table
--
-- Stores individual contact people associated with organizations.
-- Separate from the basic phone/email fields on the organizations record,
-- which represent the general company contact info.

CREATE TABLE contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id)
    on delete cascade not null,
  name text,
  title text,
  phone text,
  email text,
  contact_type text default 'primary',
  source text,
  verified boolean default false,
  created_at timestamptz default now()
);

CREATE INDEX contacts_organization_id_idx
  ON contacts(organization_id);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Contacts are publicly readable"
  ON contacts FOR SELECT USING (true);
