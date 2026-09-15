-- Opsionale: kolona payment_method (kodi përdor metadata_json.payment_method = 'bank').
-- Fatura bankare lëshohet VETËM pas konfirmimit Super Admin.
ALTER TABLE license_stripe_payments
  ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'stripe';

COMMENT ON COLUMN license_stripe_payments.payment_method IS
  'stripe | bank — opsionale; burimi i vërtetë mund të jetë metadata_json';
