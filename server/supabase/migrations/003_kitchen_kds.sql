-- KDS: kitchen slug/key te klientët, status porosish

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS kitchen_slug TEXT,
  ADD COLUMN IF NOT EXISTS kitchen_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_kitchen_slug
  ON clients (kitchen_slug) WHERE kitchen_slug IS NOT NULL AND kitchen_slug <> '';

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'closed',
  ADD COLUMN IF NOT EXISTS ordered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ;

ALTER TABLE sales_orders DROP CONSTRAINT IF EXISTS sales_orders_status_check;
ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_status_check
  CHECK (status IN ('ordered', 'ready', 'closed', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_sales_kitchen_queue
  ON sales_orders (client_id, status, ordered_at DESC NULLS LAST);

COMMENT ON COLUMN clients.kitchen_slug IS 'Slug për URL /kitchen/:slug';
COMMENT ON COLUMN clients.kitchen_key IS 'Çelës sekret për ekranin e kuzhinës (?k=)';
