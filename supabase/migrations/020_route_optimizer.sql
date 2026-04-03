-- Route Optimizer: saved_routes table

CREATE TABLE saved_routes (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users(id) on delete cascade,
  route_name          text not null,
  start_address       text not null,
  end_address         text not null,
  stops               jsonb not null default '[]',
  optimized_order     jsonb,           -- array of stop indices in visit order
  total_distance_km   numeric,
  status              text default 'draft',
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

ALTER TABLE saved_routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own routes"
  ON saved_routes FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Auto-update updated_at on any row change
CREATE TRIGGER saved_routes_updated_at
  BEFORE UPDATE ON saved_routes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
