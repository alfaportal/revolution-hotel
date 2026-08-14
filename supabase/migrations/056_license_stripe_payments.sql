-- Pagesa Stripe për licenca (Checkout) — e njëjta ide si KetuJemi
CREATE TABLE IF NOT EXISTS license_stripe_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'failed', 'cancelled')),
  package_plan TEXT NOT NULL,
  package_tier TEXT NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'eur',
  business_name TEXT NOT NULL DEFAULT '',
  owner_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  tipi TEXT NOT NULL DEFAULT 'restorant',
  stripe_session_id TEXT,
  stripe_payment_intent TEXT,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  license_id UUID REFERENCES licenses(id) ON DELETE SET NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_license_stripe_payments_status
  ON license_stripe_payments (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_license_stripe_payments_session
  ON license_stripe_payments (stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_license_stripe_payments_email
  ON license_stripe_payments (email);

COMMENT ON TABLE license_stripe_payments IS
  'Checkout Stripe për Pako 1–3 (vjetore). Pako 4 AI mbetet kontakt manual.';
