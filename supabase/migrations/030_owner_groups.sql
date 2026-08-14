-- Multi-location: një pronar / grup → shumë lokale (clients)

CREATE TABLE IF NOT EXISTS owner_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  emri        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS owner_group_id UUID REFERENCES owner_groups(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS owner_group_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_group_id  UUID NOT NULL REFERENCES owner_groups(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_clients_owner_group ON clients (owner_group_id);
CREATE INDEX IF NOT EXISTS idx_owner_group_members_user ON owner_group_members (user_id);

COMMENT ON TABLE owner_groups IS 'Grup biznesi — disa lokale (clients) nën një pronar.';
COMMENT ON TABLE owner_group_members IS 'Pronarët që kanë akses në të gjitha lokalet e grupit.';
