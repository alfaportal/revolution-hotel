-- Arkë fiskale (ATK Kosovo) + Raporti Ditor (Z-Report) për çdo biznes

ALTER TABLE pos_settings
  ADD COLUMN IF NOT EXISTS fiscal_nr TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS fiscal_com_port TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS fiscal_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS fiscal_operator_name TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS fiscal_device_model TEXT DEFAULT '';

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fiscal_receipt_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_orders_payment_status_check'
  ) THEN
    ALTER TABLE sales_orders
      ADD CONSTRAINT sales_orders_payment_status_check
      CHECK (payment_status IN ('pending', 'paid', 'manual', 'failed', 'refunded'));
  END IF;
END $$;

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

CREATE INDEX IF NOT EXISTS idx_fiscal_receipts_sale
  ON fiscal_receipts (sale_order_id);

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

-- Shitjet e mbyllura para migrimit = të paguara (legacy)
UPDATE sales_orders
SET payment_status = 'paid', paid_at = COALESCE(closed_at, created_at)
WHERE status = 'closed' AND payment_status = 'pending';

-- Default fiscal_nr nga TVSH/NUI ku ekziston
UPDATE pos_settings ps
SET fiscal_nr = COALESCE(NULLIF(ps.fiscal_nr, ''), NULLIF(ps.tvsh_nr, ''), NULLIF(ps.nui, ''))
WHERE fiscal_nr IS NULL OR fiscal_nr = '';
