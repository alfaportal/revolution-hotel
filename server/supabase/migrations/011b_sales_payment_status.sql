-- Pagesa e shitjes (cloud POS) — pa arkë fiskale / Z-report.
-- Ekzekuto pas 002/003 (sales_orders). Para 012_fiscal_zreport nëse do vetëm pagesë.

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

-- Shitjet e mbyllura para migrimit = të paguara (legacy)
UPDATE sales_orders
SET payment_status = 'paid', paid_at = COALESCE(closed_at, created_at)
WHERE status = 'closed' AND payment_status = 'pending';
