-- Merge recycling_center → mrf
-- The two types are redundant; mrf (Material Recovery Facility) is the
-- canonical term that already includes recycling centers.

UPDATE disposal_facilities
SET    facility_type = 'mrf'
WHERE  facility_type = 'recycling_center';
