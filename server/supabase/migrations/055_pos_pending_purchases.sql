-- Fatura blerjeje nga paneli (telefon/AI) → radhë për POS desktop (KAFENE).
-- POS i tërheq dhe i regjistron lokalisht: Stoku + Blerjet + Kontabilisti.

CREATE TABLE IF NOT EXISTS pos_pending_purchases (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  supplier          TEXT NOT NULL DEFAULT '',
  invoice_number    TEXT NOT NULL DEFAULT '',
  invoice_date      DATE,
  items_json        JSONB NOT NULL DEFAULT '[]'::jsonb,
  source            TEXT NOT NULL DEFAULT 'ai_invoice_scan',
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'applied', 'cancelled')),
  applied_at        TIMESTAMPTZ,
  applied_note      TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_pending_purchases_client_status
  ON pos_pending_purchases (client_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_pos_pending_purchases_invoice
  ON pos_pending_purchases (client_id, supplier, invoice_number)
  WHERE status = 'pending';

COMMENT ON TABLE pos_pending_purchases IS
  'Blerje nga owner/AI telefon — POS i aplikon me createPurchaseInvoice (stok + Blerjet + Kontabilisti)';
