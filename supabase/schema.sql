-- Revolution Invest POS — skema Supabase
-- Ekzekutoni në Supabase SQL Editor

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Klientët (restorante / kafene)
CREATE TABLE IF NOT EXISTS clients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  emri        TEXT NOT NULL,
  adresa      TEXT DEFAULT '',
  telefoni    TEXT DEFAULT '',
  email       TEXT DEFAULT '',
  tipi        TEXT NOT NULL DEFAULT 'restorant'
              CHECK (tipi IN (
                'kafene', 'restorant', 'bar', 'pub_lounge', 'piceri',
                'fast_food', 'kebab', 'pasticeri', 'akullore', 'gjeltore',
                'furre_buke', 'hotel_restorant', 'bar_nate', 'klub',
                'market', 'minimarket', 'dyqan_rroba', 'dyqan_kepuce', 'dyqan',
                'farmaci', 'optike', 'berber', 'sallon_bukurie', 'tjeter'
              )),
  kitchen_slug TEXT,
  kitchen_key  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clients_emri ON clients (emri);
CREATE INDEX IF NOT EXISTS idx_clients_tipi ON clients (tipi);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_kitchen_slug
  ON clients (kitchen_slug) WHERE kitchen_slug IS NOT NULL AND kitchen_slug <> '';

-- Liçensat
CREATE TABLE IF NOT EXISTS licenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  app_type        TEXT NOT NULL DEFAULT 'restorant'
                  CHECK (app_type IN ('restorant', 'kafene')),
  device_id       TEXT DEFAULT '',
  device_hostname TEXT DEFAULT '',
  last_activated_at TIMESTAMPTZ,
  last_ip         TEXT DEFAULT '',
  last_validation_at TIMESTAMPTZ,
  last_validation_error TEXT DEFAULT '',
  celesi          TEXT NOT NULL UNIQUE,
  statusi         TEXT NOT NULL DEFAULT 'aktive'
                  CHECK (statusi IN ('aktive', 'skaduar', 'revokuar', 'pezulluar')),
  data_fillimit   DATE NOT NULL DEFAULT CURRENT_DATE,
  data_skadimit   DATE NOT NULL,
  max_terminals   INTEGER NOT NULL DEFAULT 1,
  terminal_price  NUMERIC(12, 2) NOT NULL DEFAULT 0,
  base_price      NUMERIC(12, 2) NOT NULL DEFAULT 0,
  terminal_limit_grace_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS license_terminals (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id         UUID NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  device_id          TEXT NOT NULL,
  device_hostname    TEXT NOT NULL DEFAULT '',
  last_ip            TEXT NOT NULL DEFAULT '',
  first_activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (license_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_licenses_client ON licenses (client_id);
CREATE INDEX IF NOT EXISTS idx_licenses_app_type ON licenses (app_type);
CREATE INDEX IF NOT EXISTS idx_licenses_celesi ON licenses (celesi);
CREATE INDEX IF NOT EXISTS idx_licenses_device ON licenses (device_id);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses (statusi);
CREATE INDEX IF NOT EXISTS idx_licenses_last_activated ON licenses (last_activated_at DESC NULLS LAST);

-- Përdoruesit e panelit
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES clients(id) ON DELETE SET NULL,
  emri        TEXT NOT NULL,
  email             TEXT NOT NULL UNIQUE,
  passwordi         TEXT,
  invite_token      TEXT,
  invite_expires_at TIMESTAMPTZ,
  password_set_at   TIMESTAMPTZ,
  roli        TEXT NOT NULL DEFAULT 'client_admin'
              CHECK (roli IN ('super_admin', 'client_admin')),
  aktiv       BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_client ON users (client_id);
CREATE INDEX IF NOT EXISTS idx_users_roli ON users (roli);
CREATE INDEX IF NOT EXISTS idx_users_aktiv ON users (aktiv);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_token
  ON users (invite_token) WHERE invite_token IS NOT NULL AND invite_token <> '';

-- Shitjet e sinkronizuara nga POS
CREATE TABLE IF NOT EXISTS sales_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  license_id      UUID REFERENCES licenses(id) ON DELETE SET NULL,
  local_order_id  TEXT NOT NULL DEFAULT '',
  device_id       TEXT NOT NULL DEFAULT '',
  table_number    INTEGER DEFAULT 0,
  waiter_name     TEXT DEFAULT '',
  waiter_id       UUID REFERENCES pos_staff(id) ON DELETE SET NULL,
  items_json      JSONB NOT NULL DEFAULT '[]'::jsonb,
  total           NUMERIC(12, 2) NOT NULL DEFAULT 0,
  receipt_number  TEXT DEFAULT '',
  payment_status  TEXT NOT NULL DEFAULT 'pending'
                  CHECK (payment_status IN ('pending', 'paid', 'manual', 'failed', 'refunded')),
  payment_method  TEXT NOT NULL DEFAULT 'cash',
  paid_at         TIMESTAMPTZ,
  fiscal_receipt_id UUID,
  status          TEXT NOT NULL DEFAULT 'closed'
                  CHECK (status IN ('ordered', 'ready', 'closed', 'cancelled')),
  ordered_at      TIMESTAMPTZ,
  ready_at        TIMESTAMPTZ,
  closed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, local_order_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_client ON sales_orders (client_id);
CREATE INDEX IF NOT EXISTS idx_sales_closed ON sales_orders (closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_client_closed ON sales_orders (client_id, closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_kitchen_queue
  ON sales_orders (client_id, status, ordered_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS fiscal_receipts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  sale_order_id   UUID REFERENCES sales_orders(id) ON DELETE SET NULL,
  local_order_id  TEXT DEFAULT '',
  device_id       TEXT DEFAULT '',
  fiscal_nr       TEXT DEFAULT '',
  coupon_nr       TEXT DEFAULT '',
  serial_nr       TEXT DEFAULT '',
  total_gross     NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_net       NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_vat       NUMERIC(12, 2) NOT NULL DEFAULT 0,
  cash_given      NUMERIC(12, 2) NOT NULL DEFAULT 0,
  payment_method  TEXT NOT NULL DEFAULT 'cash',
  vat_breakdown   JSONB NOT NULL DEFAULT '{}'::jsonb,
  items_json      JSONB NOT NULL DEFAULT '[]'::jsonb,
  status          TEXT NOT NULL DEFAULT 'printed'
                  CHECK (status IN ('printed', 'manual', 'failed', 'pending')),
  com_port        TEXT DEFAULT '',
  register_connected BOOLEAN NOT NULL DEFAULT true,
  raw_response    JSONB NOT NULL DEFAULT '{}'::jsonb,
  printed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fiscal_receipts_client_date
  ON fiscal_receipts (client_id, printed_at DESC);

CREATE TABLE IF NOT EXISTS daily_z_reports (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  report_date         DATE NOT NULL,
  coupon_count        INTEGER NOT NULL DEFAULT 0,
  turnover_total      NUMERIC(14, 2) NOT NULL DEFAULT 0,
  turnover_net        NUMERIC(14, 2) NOT NULL DEFAULT 0,
  turnover_vat        NUMERIC(14, 2) NOT NULL DEFAULT 0,
  vat_breakdown       JSONB NOT NULL DEFAULT '{}'::jsonb,
  cash_register_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  cumulative_turnover NUMERIC(14, 2) NOT NULL DEFAULT 0,
  responsible_person  TEXT DEFAULT '',
  fiscal_nr           TEXT DEFAULT '',
  sales_json          JSONB NOT NULL DEFAULT '[]'::jsonb,
  closed_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_z_reports_client
  ON daily_z_reports (client_id, report_date DESC);

-- Katalog POS (menu, tavolina, stafi) — sync nga Electron
CREATE TABLE IF NOT EXISTS pos_settings (
  client_id         UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  restaurant_name   TEXT DEFAULT '',
  address           TEXT DEFAULT '',
  phone             TEXT DEFAULT '',
  nui               TEXT DEFAULT '',
  tvsh_nr           TEXT DEFAULT '',
  receipt_width_mm  INTEGER NOT NULL DEFAULT 80 CHECK (receipt_width_mm IN (58, 80)),
  table_count       INTEGER NOT NULL DEFAULT 10,
  fiscal_nr         TEXT DEFAULT '',
  fiscal_com_port   TEXT DEFAULT '',
  fiscal_enabled    BOOLEAN NOT NULL DEFAULT true,
  fiscal_operator_name TEXT DEFAULT '',
  fiscal_device_model  TEXT DEFAULT '',
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  public_enabled    BOOLEAN NOT NULL DEFAULT true,
  public_description TEXT NOT NULL DEFAULT '',
  public_hours      JSONB NOT NULL DEFAULT '{}',
  public_logo       TEXT NOT NULL DEFAULT '',
  public_theme_color TEXT NOT NULL DEFAULT '#c2410c'
);

CREATE TABLE IF NOT EXISTS pos_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (client_id, name)
);

CREATE TABLE IF NOT EXISTS pos_menu_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  local_id    INTEGER NOT NULL DEFAULT 0,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT '',
  price       NUMERIC(12, 2) NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  photo       TEXT NOT NULL DEFAULT '',
  stock_quantity INTEGER,
  stock_alert_threshold INTEGER NOT NULL DEFAULT 5,
  track_stock BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (client_id, local_id)
);

CREATE TABLE IF NOT EXISTS stock_alert_notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  menu_item_id  UUID NOT NULL REFERENCES pos_menu_items(id) ON DELETE CASCADE,
  notified_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, menu_item_id)
);

CREATE TABLE IF NOT EXISTS pos_staff (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'waiter' CHECK (role IN ('waiter', 'kitchen')),
  source      TEXT NOT NULL DEFAULT 'owner' CHECK (source IN ('owner', 'pos')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  pin_hash    TEXT,
  web_token   TEXT,
  active      BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (client_id, name)
);

CREATE TABLE IF NOT EXISTS pos_areas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  table_count   INTEGER NOT NULL DEFAULT 1 CHECK (table_count >= 0 AND table_count <= 30),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, name)
);

CREATE INDEX IF NOT EXISTS idx_pos_areas_client ON pos_areas (client_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_pos_staff_role ON pos_staff (client_id, role, active);

-- Përditëso updated_at te licenses
CREATE OR REPLACE FUNCTION set_licenses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_licenses_updated ON licenses;
CREATE TRIGGER trg_licenses_updated
  BEFORE UPDATE ON licenses
  FOR EACH ROW EXECUTE FUNCTION set_licenses_updated_at();

-- RLS: çaktivizo për server që përdor service role key
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;

-- Politikat lejojnë service role (bypass RLS automatikisht me service key)

COMMENT ON TABLE clients IS 'Restorantet dhe kafenet e regjistruara';
COMMENT ON TABLE licenses IS 'Liçensat POS të lidhura me klient dhe pajisje';
COMMENT ON TABLE users IS 'Pronarët dhe super admin për panelin web';
COMMENT ON TABLE sales_orders IS 'Shitjet e dërguara nga POS Electron në kohë reale';
COMMENT ON COLUMN users.aktiv IS 'false = pronari nuk mund të hyjë në panel';
