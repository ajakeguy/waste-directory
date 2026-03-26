-- Migration 012: Clean up duplicate organization records
--
-- Fixes one exact duplicate (Thayer Transport LLC) and merges contacts
-- from VT DEC Casella records into our primary manually-seeded Casella record.

-- ── Thayer Transport LLC ──────────────────────────────────────────────────────
-- Move contacts from the vt_dec_permit_2025 duplicate to the canonical record
UPDATE contacts
SET organization_id = (
  SELECT id FROM organizations
  WHERE slug = 'thayer-transport-llc-wallingford'
    AND data_source != 'vt_dec_permit_2025'
  LIMIT 1
)
WHERE organization_id = (
  SELECT id FROM organizations
  WHERE slug = 'thayer-transport-llc-wallingford'
    AND data_source = 'vt_dec_permit_2025'
  LIMIT 1
);

-- Move any saved items from the duplicate to the canonical record
UPDATE saved_items
SET item_id = (
  SELECT id FROM organizations
  WHERE slug = 'thayer-transport-llc-wallingford'
    AND data_source != 'vt_dec_permit_2025'
  LIMIT 1
)
WHERE item_id = (
  SELECT id FROM organizations
  WHERE slug = 'thayer-transport-llc-wallingford'
    AND data_source = 'vt_dec_permit_2025'
  LIMIT 1
);

-- Deactivate the duplicate (never hard-delete per business rules)
UPDATE organizations
SET active = false
WHERE slug = 'thayer-transport-llc-wallingford'
  AND data_source = 'vt_dec_permit_2025';

-- ── Casella Waste Management ──────────────────────────────────────────────────
-- Merge contacts from all VT DEC Casella permit records into the canonical org
UPDATE contacts
SET organization_id = (
  SELECT id FROM organizations
  WHERE slug = 'casella-waste-management-vt'
)
WHERE organization_id IN (
  SELECT id FROM organizations
  WHERE name ILIKE '%casella%'
    AND slug != 'casella-waste-management-vt'
    AND data_source = 'vt_dec_permit_2025'
);
