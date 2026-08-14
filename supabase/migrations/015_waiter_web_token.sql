-- Link personal për çdo kamarier (tablet) — ?w=token

ALTER TABLE pos_staff
  ADD COLUMN IF NOT EXISTS web_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_staff_web_token
  ON pos_staff (client_id, web_token)
  WHERE web_token IS NOT NULL AND web_token <> '';
