-- Faza 10 — Njoftime push SMS/Telegram (pako_5)

CREATE TABLE IF NOT EXISTS notification_settings (
  restaurant_id         UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  telegram_chat_id      TEXT,
  sms_number            TEXT,
  notify_low_stock      BOOLEAN NOT NULL DEFAULT true,
  notify_daily_report   BOOLEAN NOT NULL DEFAULT true,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ingredient_alert_notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  ingredient_id   UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  notified_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_ingredient_alert_notifications_restaurant
  ON ingredient_alert_notifications (restaurant_id);

CREATE TABLE IF NOT EXISTS daily_report_notifications (
  restaurant_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  report_date     DATE NOT NULL,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, report_date)
);

COMMENT ON TABLE notification_settings IS 'Preferencat e njoftimeve Telegram/SMS për pronarin (pako_5)';
