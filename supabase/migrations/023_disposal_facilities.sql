-- ── 023: Disposal facilities table ──────────────────────────────────────────
-- Landfills, transfer stations, MRFs, composting sites, and other
-- disposal / processing facilities — separate from the haulers directory.

create table disposal_facilities (
  id   uuid primary key default gen_random_uuid(),

  -- Identity
  name          text not null,
  slug          text unique not null,
  facility_type text not null,
  -- facility_type values:
  --   'landfill', 'transfer_station', 'mrf', 'composting',
  --   'anaerobic_digestion', 'waste_to_energy', 'recycling_center',
  --   'hazardous_waste', 'cd_facility'

  -- Location
  address  text,
  city     text,
  state    text,
  zip      text,
  lat      numeric,
  lng      numeric,

  -- Contact
  phone         text,
  email         text,
  website       text,
  operator_name text,

  -- Regulatory
  permit_number                  text,
  permit_status                  text default 'active',
  -- 'active', 'closed', 'pending', 'inactive'
  permitted_capacity_tons_per_day numeric,

  -- Materials accepted
  accepts_msw          boolean default false,
  accepts_recycling    boolean default false,
  accepts_cd           boolean default false,
  accepts_organics     boolean default false,
  accepts_hazardous    boolean default false,
  accepts_special_waste boolean default false,

  -- Operational
  tipping_fee_per_ton   numeric,
  hours_of_operation    text,

  -- Metadata
  data_source         text,
  service_area_states text[] default '{}',
  notes               text,
  verified            boolean default false,
  active              boolean default true,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Indexes
create index idx_disposal_facilities_state
  on disposal_facilities(state);

create index idx_disposal_facilities_type
  on disposal_facilities(facility_type);

create index idx_disposal_facilities_location
  on disposal_facilities(lat, lng);

-- RLS: public read, authenticated insert/update/delete (admin via service role)
alter table disposal_facilities enable row level security;

create policy "Public read disposal facilities"
  on disposal_facilities for select
  using (true);
