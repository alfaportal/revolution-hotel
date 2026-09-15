-- Email i klientit gjatë aktivizimit të POS
ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS activation_email TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN licenses.activation_email IS
  'Email i dhënë nga klienti në ekranin e aktivizimit të POS.';
