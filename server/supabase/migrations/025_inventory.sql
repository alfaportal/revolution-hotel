-- Inventari me përbërës — ingredients + receta menu (menu_ingredients)

CREATE TABLE IF NOT EXISTS ingredients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  unit            TEXT NOT NULL DEFAULT 'copë'
                    CHECK (unit IN ('kg', 'l', 'copë')),
  quantity        NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  min_quantity    NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
  cost_per_unit   NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (cost_per_unit >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingredients_restaurant
  ON ingredients (restaurant_id);

CREATE TABLE IF NOT EXISTS menu_ingredients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id    UUID NOT NULL REFERENCES pos_menu_items(id) ON DELETE CASCADE,
  ingredient_id   UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  quantity_used   NUMERIC(12, 3) NOT NULL DEFAULT 1 CHECK (quantity_used > 0),
  UNIQUE (menu_item_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_menu_ingredients_menu
  ON menu_ingredients (menu_item_id);

CREATE INDEX IF NOT EXISTS idx_menu_ingredients_ingredient
  ON menu_ingredients (ingredient_id);

COMMENT ON TABLE ingredients IS 'Përbërësit e inventarit (restaurant_id = clients.id)';
COMMENT ON TABLE menu_ingredients IS 'Sa përbërës shpenzohet për 1 artikull menuje';
