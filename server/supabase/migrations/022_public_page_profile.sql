-- Faqja publike — cover, galeri, ofertë, vlerësime, rrjete sociale, WhatsApp

ALTER TABLE pos_settings
  ADD COLUMN IF NOT EXISTS public_cover TEXT NOT NULL DEFAULT '';

ALTER TABLE pos_settings
  ADD COLUMN IF NOT EXISTS public_gallery JSONB NOT NULL DEFAULT '[]';

ALTER TABLE pos_settings
  ADD COLUMN IF NOT EXISTS public_daily_offer TEXT NOT NULL DEFAULT '';

ALTER TABLE pos_settings
  ADD COLUMN IF NOT EXISTS public_reviews JSONB NOT NULL DEFAULT '[]';

ALTER TABLE pos_settings
  ADD COLUMN IF NOT EXISTS public_social_instagram TEXT NOT NULL DEFAULT '';

ALTER TABLE pos_settings
  ADD COLUMN IF NOT EXISTS public_social_facebook TEXT NOT NULL DEFAULT '';

ALTER TABLE pos_settings
  ADD COLUMN IF NOT EXISTS public_social_tiktok TEXT NOT NULL DEFAULT '';

ALTER TABLE pos_settings
  ADD COLUMN IF NOT EXISTS public_whatsapp TEXT NOT NULL DEFAULT '';
