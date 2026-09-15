-- Barkod produkti (USB scanner / Open Food Facts) — paneli i pronarit
ALTER TABLE pos_menu_items
  ADD COLUMN IF NOT EXISTS barcode TEXT;

COMMENT ON COLUMN pos_menu_items.barcode IS 'EAN/UPC barcode from USB scanner or manual entry';
