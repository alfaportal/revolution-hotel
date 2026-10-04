-- Pako 5 — Premium (Super Admin marketing), si MARKET.
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_package_tier_check;

ALTER TABLE clients
  ADD CONSTRAINT clients_package_tier_check
  CHECK (package_tier IN ('pako_1', 'pako_2', 'pako_3', 'pako_4', 'pako_5', 'pako_premium'));
