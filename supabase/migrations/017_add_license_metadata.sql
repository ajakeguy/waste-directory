-- Migration 017: Add license_metadata JSONB column to organizations
-- Stores state-specific license/permit data that doesn't fit the standard schema
-- e.g. ME waste category codes, PA license IDs, VT permit type, NYC BIC numbers

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS license_metadata jsonb DEFAULT '{}';

CREATE INDEX IF NOT EXISTS organizations_license_metadata_idx
  ON organizations USING gin(license_metadata);
