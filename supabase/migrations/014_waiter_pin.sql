-- PIN kamarierësh dhe lidhja e porosive me stafin

ALTER TABLE pos_staff
  ADD COLUMN IF NOT EXISTS pin_hash TEXT;

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS waiter_id UUID REFERENCES pos_staff(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_waiter_id ON sales_orders (client_id, waiter_id);
