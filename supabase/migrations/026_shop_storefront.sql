-- Webfaqe dyqanesh (/s/:slug) — tipi dyqan + fusha produktesh

ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_tipi_check;
ALTER TABLE clients ADD CONSTRAINT clients_tipi_check
  CHECK (tipi IN ('restorant', 'kafene', 'tjeter', 'dyqan'));

ALTER TABLE pos_menu_items ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE pos_menu_items ADD COLUMN IF NOT EXISTS sku TEXT NOT NULL DEFAULT '';
ALTER TABLE pos_menu_items ADD COLUMN IF NOT EXISTS compare_at_price NUMERIC(10, 2) NULL;
