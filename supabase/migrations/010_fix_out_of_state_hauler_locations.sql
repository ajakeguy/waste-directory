-- Migration 010: Fix city/state for out-of-state VT-permitted haulers
--
-- Records imported from vt_dec_permit_2025 were incorrectly set to
-- state = 'VT' even when the company is headquartered in another state
-- (e.g. a NJ-based company showing as "Fort Lee, VT").
--
-- This update sets state = hq_state for all out-of-state records so the
-- location displays correctly. service_area_states = '{VT}' is unchanged,
-- so these companies still appear in Vermont directory searches.

UPDATE organizations
SET state = hq_state
WHERE data_source = 'vt_dec_permit_2025'
  AND hq_state IS NOT NULL
  AND hq_state != 'VT'
  AND state = 'VT';
