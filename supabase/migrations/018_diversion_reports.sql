-- Migration 018: Diversion Reports
-- Allows waste haulers to create professional diversion reports for customers.

CREATE TABLE diversion_reports (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users(id) on delete cascade,
  report_name    text not null,
  hauler_name    text not null,
  hauler_logo_url text,
  customer_name  text not null,
  service_address text not null,
  service_city   text,
  service_state  text,
  service_zip    text,
  period_start   date not null,
  period_end     date not null,
  material_streams jsonb not null default '[]',
  notes          text,
  status         text default 'draft'
                   check (status in ('draft', 'published')),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

ALTER TABLE diversion_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own reports"
  ON diversion_reports FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX diversion_reports_user_id_idx ON diversion_reports(user_id);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION update_diversion_reports_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER diversion_reports_updated_at
  BEFORE UPDATE ON diversion_reports
  FOR EACH ROW EXECUTE FUNCTION update_diversion_reports_updated_at();
