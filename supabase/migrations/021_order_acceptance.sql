-- Kush e pranoi porosinë QR / web / online
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS accepted_by_waiter_id UUID REFERENCES pos_staff(id) ON DELETE SET NULL;

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS accepted_by_waiter_name TEXT DEFAULT '';

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sales_accepted_by
  ON sales_orders (client_id, accepted_by_waiter_id)
  WHERE accepted_by_waiter_id IS NOT NULL;
