-- Add accepted_materials JSONB column to disposal_facilities
-- Stores detailed material code/description list, e.g.:
-- {"codes": ["A", "BB", "C"], "descriptions": ["Asphalt", "Brick & Block", "Concrete"]}

ALTER TABLE disposal_facilities
  ADD COLUMN IF NOT EXISTS accepted_materials jsonb;

CREATE INDEX IF NOT EXISTS disposal_facilities_accepted_materials_idx
  ON disposal_facilities USING gin(accepted_materials);
