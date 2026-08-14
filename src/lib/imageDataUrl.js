/** Parse and validate base64 data URLs stored in Postgres TEXT columns. */

const IMAGE_MIME_RE = /^image\/(?:png|jpeg|jpg|webp|gif)$/i;

function parseImageDataUrl(raw, maxBytes) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const match = s.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/i);
  if (!match) return null;
  try {
    const buf = Buffer.from(match[2], "base64");
    if (buf.length > maxBytes) return null;
    return { mime: match[1].toLowerCase(), buffer: buf };
  } catch {
    return null;
  }
}

function validateImageDataUrl(raw, { maxBytes, maxChars, label = "Imazhi" } = {}) {
  if (raw == null || raw === "") return "";
  const parsed = parseImageDataUrl(raw, maxBytes);
  if (!parsed) {
    const kb = Math.round(maxBytes / 1024);
    throw new Error(`${label} duhet të jetë PNG/JPG (max ${kb} KB).`);
  }
  const s = String(raw).trim();
  if (maxChars && s.length > maxChars) {
    throw new Error(`${label} është shumë i madh.`);
  }
  return s;
}

function imageBufferFromDataUrl(raw, maxBytes) {
  return parseImageDataUrl(raw, maxBytes)?.buffer || null;
}

function imageMimeFromDataUrl(raw, maxBytes) {
  const parsed = parseImageDataUrl(raw, maxBytes);
  return parsed?.mime || null;
}

module.exports = {
  IMAGE_MIME_RE,
  parseImageDataUrl,
  validateImageDataUrl,
  imageBufferFromDataUrl,
  imageMimeFromDataUrl,
};
