-- Migration 004: Add hq_state column to organizations
--
-- Stores the company's actual headquarters/mailing address state,
-- separate from `state` which records the VT permit jurisdiction.
-- Populated by the VT DEC importer for out-of-state companies that
-- hold Vermont waste transporter permits.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS hq_state text;

COMMENT ON COLUMN organizations.hq_state IS
  'Company headquarters/mailing address state (2-letter code). '
  'Distinct from `state`, which represents the permit/service jurisdiction.';
