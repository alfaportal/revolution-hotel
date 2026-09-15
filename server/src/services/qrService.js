const QRCode = require("qrcode");

async function qrPngBuffer(text, options = {}) {
  const payload = String(text || "").trim();
  if (!payload) throw new Error("Mungon URL për QR.");
  if (payload.length > 2048) throw new Error("URL shumë i gjatë për QR.");

  return QRCode.toBuffer(payload, {
    type: "png",
    width: options.width || 280,
    margin: options.margin ?? 2,
    errorCorrectionLevel: options.errorCorrectionLevel || "M",
    color: {
      dark: "#0f172a",
      light: "#ffffff",
    },
  });
}

function assertSameOriginUrl(url, baseUrl) {
  const base = new URL(baseUrl);
  const parsed = new URL(url, baseUrl);
  if (parsed.origin !== base.origin) {
    throw new Error("URL duhet të jetë i platformës sonë.");
  }
  return parsed.href;
}

module.exports = { qrPngBuffer, assertSameOriginUrl };
