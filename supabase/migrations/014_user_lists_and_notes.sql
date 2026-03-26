-- User-created lists to organize saved haulers
CREATE TABLE IF NOT EXISTS user_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  name text not null,
  description text,
  color text default '#2D6A4F',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

CREATE INDEX IF NOT EXISTS user_lists_user_id_idx
  ON user_lists(user_id);

ALTER TABLE user_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own lists"
  ON user_lists FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Add list_id and notes to saved_items
ALTER TABLE saved_items
  ADD COLUMN IF NOT EXISTS list_id uuid
    references user_lists(id) on delete set null;

ALTER TABLE saved_items
  ADD COLUMN IF NOT EXISTS notes text;
