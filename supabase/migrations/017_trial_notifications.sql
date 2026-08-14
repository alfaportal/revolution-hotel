-- Regjistër njoftimesh trial (email pronari / admin) — një herë për licencë dhe lloj.

CREATE TABLE IF NOT EXISTS trial_notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id    UUID NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL
    CHECK (notification_type IN ('owner_7d', 'owner_1d', 'owner_expired', 'admin_7d')),
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (license_id, notification_type)
);

CREATE INDEX IF NOT EXISTS idx_trial_notifications_license
  ON trial_notifications (license_id);

CREATE INDEX IF NOT EXISTS idx_trial_notifications_type
  ON trial_notifications (notification_type);
