/** Shkarkon imazh nga URL dhe e kthen si data URL (max bytes). */
async function fetchImageAsDataUrl(url, maxBytes = 512_000) {
  const u = String(url || "").trim();
  if (!/^https?:\/\//i.test(u)) return "";

  const res = await fetch(u, {
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
    headers: { "User-Agent": "RevolutionPOS/1.0" },
  });
  if (!res.ok) throw new Error(`Foto: HTTP ${res.status}`);

  let mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim().toLowerCase();
  if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(mime)) {
    mime = "image/jpeg";
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error("Fotoja e katalogut është shumë e madhe.");

  return `data:${mime};base64,${buf.toString("base64")}`;
}

module.exports = { fetchImageAsDataUrl };
