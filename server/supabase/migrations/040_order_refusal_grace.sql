-- Refuzim i porosisë nga kamarieri: 2 minuta për kamarierët e tjerë para se të anulohet.
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS refused_at TIMESTAMPTZ;

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS order_expires_at TIMESTAMPTZ;

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS refused_by_waiter_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_sales_order_expires
  ON sales_orders (order_expires_at)
  WHERE status = 'ordered' AND order_expires_at IS NOT NULL;
