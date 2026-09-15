/**
 * Resolve POS `/menu-stock/*.jpg` paths stored in pos_menu_items.photo
 * to files under public/menu-stock (same studio photos as desktop POS).
 */
const fs = require("fs");
const path = require("path");

const STOCK_PHOTO_RE = /^\/menu-stock\/([a-zA-Z0-9._-]+\.(jpe?g|png|webp))$/i;
const STOCK_DIR = path.join(__dirname, "../../public/menu-stock");

function normalizeStockPhotoPath(raw) {
  const s = String(raw || "").trim().split("?")[0];
  const m = s.match(STOCK_PHOTO_RE);
  if (!m) return "";
  return `/menu-stock/${m[1]}`;
}

function stockPhotoFilePayload(raw) {
  const rel = normalizeStockPhotoPath(raw);
  if (!rel) return null;
  const fileName = rel.slice("/menu-stock/".length);
  const filePath = path.join(STOCK_DIR, fileName);
  if (!filePath.startsWith(STOCK_DIR) || !fs.existsSync(filePath)) return null;
  const ext = path.extname(fileName).toLowerCase();
  const mime =
    ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  try {
    return { buffer: fs.readFileSync(filePath), mime };
  } catch {
    return null;
  }
}

module.exports = {
  STOCK_PHOTO_RE,
  normalizeStockPhotoPath,
  stockPhotoFilePayload,
};
