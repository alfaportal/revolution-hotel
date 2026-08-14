-- Kontabilisti kërkon emrin e firmës/furnitorit që lëshoi mallin/shërbimin për
-- çdo shpenzim të vogël ditor, jo vetëm kategorinë dhe përshkrimin e lirë.
ALTER TABLE owner_expenses
  ADD COLUMN IF NOT EXISTS vendor_name TEXT NOT NULL DEFAULT '';
