-- Njoftime email për klientë offline (çdo 12h, deri në 48h).

CREATE TABLE IF NOT EXISTS offline_notifications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  license_id       UUID REFERENCES licenses(id) ON DELETE SET NULL,
  offline_since    TIMESTAMPTZ NOT NULL,
  milestone_hours  INT NOT NULL CHECK (milestone_hours IN (12, 24, 36, 48)),
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, offline_since, milestone_hours)
);

CREATE INDEX IF NOT EXISTS idx_offline_notifications_client
  ON offline_notifications (client_id);

CREATE INDEX IF NOT EXISTS idx_offline_notifications_milestone
  ON offline_notifications (milestone_hours);
