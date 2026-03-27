-- 016_equipment_marketplace.sql
-- Equipment listings marketplace table

CREATE TABLE equipment_listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  title text not null,
  description text not null,
  category text not null,
  condition text not null check (
    condition in ('new', 'used', 'refurbished')
  ),
  price numeric(10,2),
  price_negotiable boolean default false,
  quantity integer default 1,
  location_city text,
  location_state text,
  photos text[] default '{}',
  contact_name text,
  contact_email text,
  contact_phone text,
  status text default 'active' check (
    status in ('active', 'sold', 'draft', 'expired')
  ),
  expires_at timestamptz default now() + interval '90 days',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

ALTER TABLE equipment_listings ENABLE ROW LEVEL SECURITY;

-- Anyone can read active listings
CREATE POLICY "Public read active listings"
  ON equipment_listings FOR SELECT
  USING (status = 'active');

-- Users manage their own listings (any status)
CREATE POLICY "Users manage own listings"
  ON equipment_listings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX equipment_listings_user_id_idx
  ON equipment_listings(user_id);
CREATE INDEX equipment_listings_status_idx
  ON equipment_listings(status);
CREATE INDEX equipment_listings_category_idx
  ON equipment_listings(category);
