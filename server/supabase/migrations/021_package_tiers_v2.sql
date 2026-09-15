-- Pakot 1–4 (heq pako_1_1 dhe pako_2_1)
-- REND I RËNDËSISHËM: së pari hiq constraint-in e vjetër, pastaj UPDATE, pastaj constraint i ri.

ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_package_tier_check;

UPDATE clients SET package_tier = 'pako_3' WHERE package_tier = 'pako_1_1';
UPDATE clients SET package_tier = 'pako_4' WHERE package_tier = 'pako_2_1';

ALTER TABLE clients
  ADD CONSTRAINT clients_package_tier_check
  CHECK (package_tier IN ('pako_1', 'pako_2', 'pako_3', 'pako_4'));
