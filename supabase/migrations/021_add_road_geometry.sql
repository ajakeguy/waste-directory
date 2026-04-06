-- Add road geometry + miles distance to saved_routes
-- road_geometry stores the GeoJSON LineString from ORS Directions API
-- total_distance_miles stores the actual road distance in miles

ALTER TABLE saved_routes
  ADD COLUMN IF NOT EXISTS road_geometry      jsonb,
  ADD COLUMN IF NOT EXISTS total_distance_miles numeric;
