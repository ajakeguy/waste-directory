-- Migration 014: User lists and notes for saved haulers
--
-- Adds user_lists table so users can organize saved haulers into named
-- collections, and adds list_id + notes columns to saved_items.

-- ── user_lists ────────────────────────────────────────────────────────────────

CREATE TABLE user_lists (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  description text,
  color       text        NOT NULL DEFAULT '#2D6A4F',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX user_lists_user_id_idx ON user_lists(user_id);

ALTER TABLE user_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own lists"
  ON user_lists FOR ALL
  USING (auth.uid() = user_id);

-- ── saved_items additions ─────────────────────────────────────────────────────

ALTER TABLE saved_items
  ADD COLUMN IF NOT EXISTS list_id uuid
    REFERENCES user_lists(id) ON DELETE SET NULL;

ALTER TABLE saved_items
  ADD COLUMN IF NOT EXISTS notes text;

CREATE INDEX IF NOT EXISTS saved_items_list_id_idx ON saved_items(list_id);
