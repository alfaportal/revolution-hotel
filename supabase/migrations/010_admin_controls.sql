-- Log aktiviteti Super Admin + force logout licencash

CREATE TABLE IF NOT EXISTS admin_activity_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email   TEXT NOT NULL DEFAULT '',
  action        TEXT NOT NULL,
  target_type   TEXT NOT NULL DEFAULT '',
  target_id     TEXT DEFAULT '',
  target_label  TEXT DEFAULT '',
  details       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_activity_log_created
  ON admin_activity_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_activity_log_action
  ON admin_activity_log (action, created_at DESC);

ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS force_logout_at TIMESTAMPTZ;

ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;
