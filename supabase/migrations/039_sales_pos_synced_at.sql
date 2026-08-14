-- Heartbeat i sinkronizimit POS → cloud (për skadimin e tavolinave «Duke u sinkronizuar…»)
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS pos_synced_at TIMESTAMPTZ;

COMMENT ON COLUMN sales_orders.pos_synced_at IS 'Herë e fundit që POS desktop dërgoi update/sync për këtë porosi';
