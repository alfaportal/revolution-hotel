-- Stock / inventory tracking for menu items

ALTER TABLE pos_menu_items
  ADD COLUMN IF NOT EXISTS stock_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS stock_alert_threshold INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS track_stock BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN pos_menu_items.stock_quantity IS 'Remaining units when track_stock is true; NULL means not set yet';
COMMENT ON COLUMN pos_menu_items.stock_alert_threshold IS 'Email alert when quantity drops to this level or below';
COMMENT ON COLUMN pos_menu_items.track_stock IS 'When true, stock_quantity is decremented on each sale';

CREATE TABLE IF NOT EXISTS stock_alert_notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  menu_item_id  UUID NOT NULL REFERENCES pos_menu_items(id) ON DELETE CASCADE,
  notified_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, menu_item_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_alert_notifications_client
  ON stock_alert_notifications (client_id);

CREATE INDEX IF NOT EXISTS idx_pos_menu_track_stock
  ON pos_menu_items (client_id, track_stock)
  WHERE track_stock = true;
