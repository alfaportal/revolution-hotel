-- Faza 7 — Sugjerime automatike furnizimi (pako_5 / AI)

ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS last_supplier TEXT,
  ADD COLUMN IF NOT EXISTS last_supplier_email TEXT;

CREATE TABLE IF NOT EXISTS supply_suggestions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  suggestion_date     DATE NOT NULL,
  ingredient_id       UUID REFERENCES ingredients(id) ON DELETE SET NULL,
  item_name           TEXT NOT NULL,
  unit                TEXT NOT NULL DEFAULT 'copë'
                        CHECK (unit IN ('kg', 'l', 'copë')),
  current_quantity    NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK (current_quantity >= 0),
  min_quantity        NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
  order_quantity      NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK (order_quantity > 0),
  last_supplier       TEXT,
  last_supplier_email TEXT,
  ai_summary          TEXT,
  email_sent_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, suggestion_date, ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_supply_suggestions_restaurant_date
  ON supply_suggestions (restaurant_id, suggestion_date DESC);

COMMENT ON TABLE supply_suggestions IS 'Lista ditore e furnizimit — përbërës nën minimum (pako_5 AI)';
COMMENT ON COLUMN ingredients.last_supplier IS 'Furnizuesi i fundit (nga skanimi i faturës ose manual)';
COMMENT ON COLUMN ingredients.last_supplier_email IS 'Email i furnizuesit për porosi';
