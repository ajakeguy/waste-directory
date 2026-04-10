-- Migration 029: Add notes column to saved_disposal_facilities
ALTER TABLE saved_disposal_facilities
  ADD COLUMN IF NOT EXISTS notes text;
