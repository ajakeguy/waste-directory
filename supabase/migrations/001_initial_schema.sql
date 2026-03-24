-- 001_initial_schema.sql
-- Initial schema for the Waste Industry Directory MVP

-- ============================================================
-- organizations
-- ============================================================
create table organizations (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  slug                text unique not null,
  org_type            text default 'hauler',
  website             text,
  phone               text,
  email               text,
  description         text,
  logo_url            text,
  address             text,
  city                text,
  state               text not null,  -- 2-letter code: VT, NY, MA
  zip                 text,
  county              text,
  lat                 numeric,
  lng                 numeric,
  service_types       text[],         -- e.g. ['residential','commercial','roll_off']
  service_area_states text[],         -- states they serve, e.g. ['VT','NY']
  verified            boolean default false,
  active              boolean default true,
  data_source         text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  search_vector       tsvector        -- for full-text search
);

-- Index for state-based lookups
create index organizations_state_idx on organizations (state);

-- Index for active haulers
create index organizations_active_idx on organizations (active);

-- GIN index for full-text search
create index organizations_search_vector_idx on organizations using gin (search_vector);

-- GIN index for service_types array queries
create index organizations_service_types_idx on organizations using gin (service_types);

-- Auto-update search_vector on insert/update
create or replace function organizations_search_vector_update() returns trigger as $$
begin
  new.search_vector :=
    to_tsvector('english',
      coalesce(new.name, '') || ' ' ||
      coalesce(new.city, '') || ' ' ||
      coalesce(new.county, '') || ' ' ||
      coalesce(new.description, '')
    );
  return new;
end;
$$ language plpgsql;

create trigger organizations_search_vector_trigger
  before insert or update on organizations
  for each row execute function organizations_search_vector_update();

-- Auto-update updated_at timestamp
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger organizations_updated_at
  before update on organizations
  for each row execute function set_updated_at();


-- ============================================================
-- news_sources
-- ============================================================
create table news_sources (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  url             text,
  rss_url         text not null unique,
  category        text,
  active          boolean default true,
  last_fetched_at timestamptz
);


-- ============================================================
-- news_articles
-- ============================================================
create table news_articles (
  id           uuid primary key default gen_random_uuid(),
  source_id    uuid references news_sources(id),
  title        text not null,
  url          text unique not null,
  summary      text,
  published_at timestamptz,
  fetched_at   timestamptz default now(),
  image_url    text
);

create index news_articles_source_idx on news_articles (source_id);
create index news_articles_published_idx on news_articles (published_at desc);


-- ============================================================
-- users (mirrors Supabase auth.users)
-- ============================================================
create table users (
  id         uuid primary key references auth.users(id),
  email      text,
  name       text,
  user_type  text,
  created_at timestamptz default now()
);


-- ============================================================
-- saved_items
-- ============================================================
create table saved_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references users(id) on delete cascade,
  item_type  text,  -- 'organization'
  item_id    uuid,
  created_at timestamptz default now(),
  unique(user_id, item_id)
);

create index saved_items_user_idx on saved_items (user_id);


-- ============================================================
-- Row Level Security
-- ============================================================

-- organizations: public read, service role write
alter table organizations enable row level security;
create policy "organizations_public_read" on organizations
  for select using (active = true);

-- news_sources: public read
alter table news_sources enable row level security;
create policy "news_sources_public_read" on news_sources
  for select using (active = true);

-- news_articles: public read
alter table news_articles enable row level security;
create policy "news_articles_public_read" on news_articles
  for select using (true);

-- users: users can read/update their own record
alter table users enable row level security;
create policy "users_own_read" on users
  for select using (auth.uid() = id);
create policy "users_own_update" on users
  for update using (auth.uid() = id);

-- saved_items: users manage their own saved items
alter table saved_items enable row level security;
create policy "saved_items_own" on saved_items
  for all using (auth.uid() = user_id);
