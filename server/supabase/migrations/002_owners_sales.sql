-- Migrimi 002: pronarë aktiv/çaktiv + shitjet nga POS
-- Ekzekutoni në Supabase SQL Editor (pas schema.sql)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS aktiv BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_users_aktiv ON users (aktiv);

-- Porositë / shitjet e sinkronizuara nga POS
CREATE TABLE IF NOT EXISTS sales_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  license_id      UUID REFERENCES licenses(id) ON DELETE SET NULL,
  local_order_id  TEXT NOT NULL DEFAULT '',
  device_id       TEXT NOT NULL DEFAULT '',
  table_number    INTEGER DEFAULT 0,
  waiter_name     TEXT DEFAULT '',
  items_json      JSONB NOT NULL DEFAULT '[]'::jsonb,
  total           NUMERIC(12, 2) NOT NULL DEFAULT 0,
  receipt_number  TEXT DEFAULT '',
  closed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, local_order_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_client ON sales_orders (client_id);
CREATE INDEX IF NOT EXISTS idx_sales_closed ON sales_orders (closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_client_closed ON sales_orders (client_id, closed_at DESC);

COMMENT ON TABLE sales_orders IS 'Shitjet e dërguara nga POS Electron në kohë reale';
COMMENT ON COLUMN users.aktiv IS 'false = pronari nuk mund të hyjë në panel';
