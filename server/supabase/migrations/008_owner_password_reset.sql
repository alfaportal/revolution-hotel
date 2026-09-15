-- Rivendosje fjalëkalimi pronar (kod OTP në email)
CREATE TABLE IF NOT EXISTS owner_password_resets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_owner_password_resets_email
  ON owner_password_resets (email, expires_at DESC);
