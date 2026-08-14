-- Mbështet panelin e pronarit: TVSH per-artikull (A-E), numri serial i PEF,
-- anulim porosie me arsye, barazimi i arkës te Z-Report (paraja e nisjes /
-- e numëruar / diferenca + arsyeja), shpenzimet e vogla ditore, dhe një
-- audit log i veçantë PËR KLIENT (ndryshe nga admin_activity_log global,
-- i cili nuk ka client_id dhe s'duhet përdorur për pronarët).

-- 1) TVSH per artikull menuje (A=18%, B=8%, C=0%, D=përjashtuar, E=tjetër)
ALTER TABLE pos_menu_items
  ADD COLUMN IF NOT EXISTS vat_category TEXT NOT NULL DEFAULT 'A';

ALTER TABLE pos_menu_items DROP CONSTRAINT IF EXISTS pos_menu_items_vat_category_check;
ALTER TABLE pos_menu_items
  ADD CONSTRAINT pos_menu_items_vat_category_check
  CHECK (vat_category IN ('A', 'B', 'C', 'D', 'E'));

-- 2) Numri serial i PEF (Pajisja Elektronike Fiskale) — fushë settings, jo vetëm
--    ai i kapur automatikisht për-kupon te fiscal_receipts.serial_nr
ALTER TABLE pos_settings
  ADD COLUMN IF NOT EXISTS pef_serial_number TEXT NOT NULL DEFAULT '';

-- 3) Anulim porosie me arsye (pas printimit) — RUAJTUR VETËM te owner_activity_log
--    (poshtë), JO si kolona te sales_orders — Rregulli #11: mos u shto kolona
--    tabelës sales_orders pa leje. sales_orders.status='cancelled' ekziston
--    tashmë (asnjë ndryshim skeme atje); arsyeja/aktori/koha shkojnë te
--    owner_activity_log.details (JSONB).

-- 4) Barazimi i arkës për Z-Report (nuk ka koncept "shift" te cloud-i — një
--    "ditë" = një "arkë" për klientin, siç e trajton tashmë daily_z_reports)
ALTER TABLE daily_z_reports
  ADD COLUMN IF NOT EXISTS opening_float NUMERIC(12, 2);
ALTER TABLE daily_z_reports
  ADD COLUMN IF NOT EXISTS closing_cash_actual NUMERIC(12, 2);
ALTER TABLE daily_z_reports
  ADD COLUMN IF NOT EXISTS cash_difference NUMERIC(12, 2);
ALTER TABLE daily_z_reports
  ADD COLUMN IF NOT EXISTS cash_difference_reason TEXT NOT NULL DEFAULT '';

-- 5) Shpenzime të vogla ditore (jashtë blerjeve të stokut)
CREATE TABLE IF NOT EXISTS owner_expenses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  category      TEXT NOT NULL DEFAULT 'tjeter',
  amount        NUMERIC(12, 2) NOT NULL DEFAULT 0,
  description   TEXT NOT NULL DEFAULT '',
  entered_by    TEXT NOT NULL DEFAULT '',
  expense_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_owner_expenses_client_date
  ON owner_expenses (client_id, expense_date DESC);

-- 6) Audit log PËR KLIENT (çmime të ndryshuara, porosi/fatura të anulluara, etj.)
--    — i veçantë nga admin_activity_log (ai është global, pa client_id, për
--    Super Adminin e platformës, jo për pronarët e restoranteve).
CREATE TABLE IF NOT EXISTS owner_activity_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  actor_email   TEXT NOT NULL DEFAULT '',
  action        TEXT NOT NULL,
  target_type   TEXT NOT NULL DEFAULT '',
  target_id     TEXT NOT NULL DEFAULT '',
  target_label  TEXT NOT NULL DEFAULT '',
  details       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_owner_activity_log_client
  ON owner_activity_log (client_id, created_at DESC);

COMMENT ON COLUMN pos_menu_items.vat_category IS 'Kategoria TVSH ATK: A=18%, B=8%, C=0%, D=përjashtuar, E=tjetër';
COMMENT ON COLUMN pos_settings.pef_serial_number IS 'Numri serial i Pajisjes Elektronike Fiskale (PEF) — shfaqet në X/Z raporte';
COMMENT ON COLUMN daily_z_reports.opening_float IS 'Paraja e nisjes së arkës për ditën (vendosur nga pronari para shitjeve)';
COMMENT ON COLUMN daily_z_reports.closing_cash_actual IS 'Paraja e numëruar fizikisht në mbyllje të ditës';
COMMENT ON COLUMN daily_z_reports.cash_difference IS 'closing_cash_actual - (opening_float + cash_register_balance)';
