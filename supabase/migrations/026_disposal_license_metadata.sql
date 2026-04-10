-- Add license_metadata JSONB column to disposal_facilities
-- Stores state-specific permit/license data that doesn't fit the standard schema
-- e.g. PA EPA ID, PA county, PA municipality, facility info links

ALTER TABLE disposal_facilities
  ADD COLUMN IF NOT EXISTS license_metadata jsonb DEFAULT '{}';

CREATE INDEX IF NOT EXISTS disposal_facilities_license_metadata_idx
  ON disposal_facilities USING gin(license_metadata);
