-- Arsye refuzimi + historik për panelin e pronarit / AI waiter rating
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS refuse_reason TEXT;

CREATE TABLE IF NOT EXISTS order_refusal_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  waiter_id TEXT NOT NULL DEFAULT '',
  waiter_name TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  table_number INTEGER,
  total NUMERIC(12, 2),
  items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  device_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_refusal_events_client_created
  ON order_refusal_events (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_refusal_events_order
  ON order_refusal_events (sales_order_id);
