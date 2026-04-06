-- ── 022: Saved locations + user route preferences ──────────────────────────

-- Saved depot / disposal facility locations per user
create table saved_locations (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  name        text        not null,
  address     text        not null,
  type        text        not null check (type in ('depot', 'disposal', 'both')),
  lat         numeric,
  lng         numeric,
  created_at  timestamptz default now()
);

alter table saved_locations enable row level security;

create policy "Users manage own saved locations"
  on saved_locations for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index saved_locations_user_id_idx on saved_locations(user_id);

-- User-specific default assumptions for the route cost estimator
create table user_route_preferences (
  user_id               uuid    primary key references auth.users(id) on delete cascade,
  service_min_per_stop  numeric not null default 15,
  mpg                   numeric not null default 8,
  fuel_price_per_gallon numeric not null default 4.5,
  labor_rate_per_hour   numeric not null default 35,
  lbs_per_yard          numeric not null default 300,
  disposal_cost_per_ton numeric not null default 85,
  updated_at            timestamptz default now()
);

alter table user_route_preferences enable row level security;

create policy "Users manage own route preferences"
  on user_route_preferences for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
