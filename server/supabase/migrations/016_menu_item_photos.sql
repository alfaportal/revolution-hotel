-- Menu item photos for public restaurant page

ALTER TABLE pos_menu_items
  ADD COLUMN IF NOT EXISTS photo TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN pos_menu_items.photo IS 'Item photo as data URL (base64) for public menu display';
