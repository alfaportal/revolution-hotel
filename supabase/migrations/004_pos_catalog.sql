-- Katalog POS (menu, tavolina, stafi) — sync nga Electron

CREATE TABLE IF NOT EXISTS pos_settings (
  client_id         UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  restaurant_name   TEXT DEFAULT '',
  table_count       INTEGER NOT NULL DEFAULT 10,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pos_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (client_id, name)
);

CREATE INDEX IF NOT EXISTS idx_pos_categories_client ON pos_categories (client_id);

CREATE TABLE IF NOT EXISTS pos_menu_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  local_id    INTEGER NOT NULL DEFAULT 0,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT '',
  price       NUMERIC(12, 2) NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (client_id, local_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_menu_client ON pos_menu_items (client_id);
CREATE INDEX IF NOT EXISTS idx_pos_menu_active ON pos_menu_items (client_id, active);

CREATE TABLE IF NOT EXISTS pos_staff (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (client_id, name)
);

CREATE INDEX IF NOT EXISTS idx_pos_staff_client ON pos_staff (client_id);
