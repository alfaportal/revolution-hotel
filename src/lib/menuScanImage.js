const { IMAGE_MIME_RE, parseImageDataUrl } = require("./imageDataUrl");

const MAX_MENU_SCAN_BYTES = 4_000_000;

function normalizeMime(mime) {
  const m = String(mime || "").trim().toLowerCase();
  if (m === "image/jpg") return "image/jpeg";
  if (IMAGE_MIME_RE.test(m)) return m;
  return "";
}

function fromUploadedFile(file) {
  if (!file?.buffer?.length) return null;
  const mime = normalizeMime(file.mimetype);
  if (!mime) throw new Error("Foto duhet PNG, JPG, WebP ose GIF.");
  if (file.buffer.length > MAX_MENU_SCAN_BYTES) {
    throw new Error("Foto është shumë e madhe (max 4 MB).");
  }
  return { mime, base64: file.buffer.toString("base64") };
}

function fromBase64String(raw, mimeHint) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;

  const parsed = parseImageDataUrl(trimmed, MAX_MENU_SCAN_BYTES);
  if (parsed) {
    return { mime: normalizeMime(parsed.mime), base64: parsed.buffer.toString("base64") };
  }

  const mime = normalizeMime(mimeHint) || "image/jpeg";
  try {
    const buf = Buffer.from(trimmed.replace(/\s/g, ""), "base64");
    if (!buf.length) return null;
    if (buf.length > MAX_MENU_SCAN_BYTES) {
      throw new Error("Foto është shumë e madhe (max 4 MB).");
    }
    return { mime, base64: buf.toString("base64") };
  } catch (e) {
    if (e.message.includes("madhe")) throw e;
    throw new Error("Base64 i fotos është i pavlefshëm.");
  }
}

function extractMenuScanImage(req) {
  const files = req.files || {};
  const uploaded =
    req.file ||
    files.photo?.[0] ||
    files.image?.[0] ||
    files.file?.[0] ||
    null;

  const fromFile = fromUploadedFile(uploaded);
  if (fromFile) return fromFile;

  const body = req.body || {};
  const raw = body.photo || body.image || body.image_base64 || body.data || "";
  const mimeHint = body.mime || body.media_type || body.content_type || "";

  const fromBody = fromBase64String(raw, mimeHint);
  if (fromBody) return fromBody;

  throw new Error("Mungon foto e menusë (upload ose base64).");
}

module.exports = {
  MAX_MENU_SCAN_BYTES,
  extractMenuScanImage,
};
