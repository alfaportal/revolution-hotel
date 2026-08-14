-- Fix clients_package_tier_check: allow pako_5 (Pako 4 — AI Profesionale).
-- Safe to re-run if 028 was never applied on production.

ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_package_tier_check;

ALTER TABLE clients
  ADD CONSTRAINT clients_package_tier_check
  CHECK (package_tier IN ('pako_1', 'pako_2', 'pako_3', 'pako_4', 'pako_5'));
