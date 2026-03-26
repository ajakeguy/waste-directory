-- Migration 013: Add license fields and ensure address/zip columns exist
--
-- Adds license_number and license_expiry for tracking permit/license data
-- imported from sources like the NYC BIC approval list.
-- address and zip are included with IF NOT EXISTS as a safety net
-- (they exist in the original schema but may be missing in some deployments).

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS license_number text;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS license_expiry date;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS zip text;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS address text;

COMMENT ON COLUMN organizations.license_number IS
  'Permit or license number from the issuing authority (e.g. NYC BIC number).';

COMMENT ON COLUMN organizations.license_expiry IS
  'Expiration date of the permit or license.';
