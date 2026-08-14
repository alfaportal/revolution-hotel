-- Ftesë pronari: vendos fjalëkalimin vetë përmes linkut /owner/setup?token=...

ALTER TABLE users
  ALTER COLUMN passwordi DROP NOT NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS invite_token TEXT,
  ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_token
  ON users (invite_token) WHERE invite_token IS NOT NULL AND invite_token <> '';

COMMENT ON COLUMN users.invite_token IS 'Token i ftesës — pronari vendos fjalëkalimin në /owner/setup';
COMMENT ON COLUMN users.invite_expires_at IS 'Skadimi i linkut të ftesës (zakonisht 48 orë)';
COMMENT ON COLUMN users.password_set_at IS 'Kur pronari aktivizoi llogarinë me fjalëkalim';
