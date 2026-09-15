const multer = require("multer");
const { IMAGE_MIME_RE } = require("../lib/imageDataUrl");
const { MAX_MENU_SCAN_BYTES } = require("../lib/menuScanImage");

const menuScanUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MENU_SCAN_BYTES, files: 1, fields: 8 },
  fileFilter(_req, file, cb) {
    if (IMAGE_MIME_RE.test(String(file.mimetype || ""))) {
      cb(null, true);
      return;
    }
    cb(new Error("Foto duhet PNG, JPG, WebP ose GIF."));
  },
});

function handleMenuScanUpload(req, res, next) {
  const contentType = String(req.headers["content-type"] || "");
  if (!contentType.includes("multipart/form-data")) {
    return next();
  }

  menuScanUpload.fields([
    { name: "photo", maxCount: 1 },
    { name: "image", maxCount: 1 },
    { name: "file", maxCount: 1 },
  ])(req, res, (err) => {
    if (!err) return next();
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "Foto është shumë e madhe (max 4 MB)."
        : err.message || "Upload i pavlefshëm.";
    return res.status(400).json({ ok: false, gabim: message });
  });
}

module.exports = { handleMenuScanUpload };
