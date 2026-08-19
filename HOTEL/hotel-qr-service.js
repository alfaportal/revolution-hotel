/**
 * QR për hotel — Room Service / Menyja / Shërbime.
 * Cloud (hotel_qr_base_url publik): /hotel/{slug}/room-service?room=…
 * LAN / lokal: /guest/room-service.html?room=…
 */
const os = require("os");
const QRCode = require("qrcode");
const { isLocalOrPrivateServerUrl } = require("./cloud-server-url");

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function detectLanBase(port) {
  const p = Number(port) || Number(process.env.ACTUAL_PORT) || Number(process.env.PORT) || 3001;
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets || {})) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        return `http://${net.address}:${p}`;
      }
    }
  }
  return `http://127.0.0.1:${p}`;
}

function resolveQrBaseUrl(db) {
  let custom = "";
  try {
    custom = String(db.getSetting?.("hotel_qr_base_url", "") || "").trim();
  } catch {
    custom = "";
  }
  if (custom) return custom.replace(/\/+$/, "");
  return detectLanBase().replace(/\/+$/, "");
}

function resolveHotelQrSlug(db) {
  try {
    const cloud = typeof db.getCloudSettings === "function" ? db.getCloudSettings() : {};
    return String(
      cloud.kitchen_slug
      || cloud.cloud_client_id
      || db.getSetting?.("kitchen_slug", "")
      || db.getSetting?.("cloud_client_id", "")
      || "",
    ).trim();
  } catch {
    return "";
  }
}

function isCloudQrBase(base) {
  const b = String(base || "").trim();
  if (!b || !/^https?:\/\//i.test(b)) return false;
  return !isLocalOrPrivateServerUrl(b);
}

function buildHotelQrUrls(base, roomNumber, slug = "") {
  const b = String(base || "").replace(/\/+$/, "");
  const room = encodeURIComponent(String(roomNumber || "").trim());
  const venueSlug = encodeURIComponent(String(slug || "").trim());

  if (isCloudQrBase(b) && venueSlug) {
    const prefix = `${b}/hotel/${venueSlug}`;
    return {
      room_service: room
        ? `${prefix}/room-service?room=${room}`
        : `${prefix}/room-service`,
      menu: `${prefix}/menu`,
      services: `${prefix}/services`,
    };
  }

  return {
    room_service: room
      ? `${b}/guest/room-service.html?room=${room}`
      : `${b}/guest/room-service.html`,
    menu: `${b}/guest/menu.html`,
    services: `${b}/guest/services.html`,
  };
}

async function qrEntry(kind, label, url) {
  const png = await QRCode.toBuffer(url, { width: 280, margin: 1 });
  const b64 = png.toString("base64");
  return {
    kind,
    label,
    url,
    png_base64: b64,
    data_url: `data:image/png;base64,${b64}`,
  };
}

async function listHotelQrs(db) {
  const settings = db.getSettings();
  const configuredBase = resolveQrBaseUrl(db);
  const slug = resolveHotelQrSlug(db);
  const useCloudQr = isCloudQrBase(configuredBase) && !!slug;
  const qrBase = useCloudQr ? configuredBase : (
    isCloudQrBase(configuredBase) ? detectLanBase() : configuredBase
  );
  try {
    db.ensureDefaultRooms?.();
  } catch {
    /* ignore */
  }
  const rooms = typeof db.listRooms === "function" ? db.listRooms() : [];
  const qrSlug = useCloudQr ? slug : "";
  const sharedMenu = await qrEntry("menu", "QR Menyja", buildHotelQrUrls(qrBase, "", qrSlug).menu);
  const sharedServices = await qrEntry("services", "QR Shërbime", buildHotelQrUrls(qrBase, "", qrSlug).services);

  const roomRows = [];
  for (const room of rooms) {
    const urls = buildHotelQrUrls(qrBase, room.room_number, qrSlug);
    const rs = await qrEntry(
      "room_service",
      `Room Service — Dh. ${room.room_number}`,
      urls.room_service,
    );
    roomRows.push({
      room_id: room.id,
      room_number: room.room_number,
      floor: room.floor,
      type: room.type,
      room_service: rs,
      menu: sharedMenu,
      services: sharedServices,
    });
  }

  return {
    base_url: qrBase,
    configured_base_url: configuredBase,
    qr_mode: useCloudQr ? "cloud" : "local",
    hotel_slug: slug || "",
    business_name: (typeof db.getBusinessName === "function" ? db.getBusinessName() : "")
      || settings.business_name
      || settings.restaurant_name
      || "Hotel",
    count: roomRows.length,
    shared: { menu: sharedMenu, services: sharedServices },
    rooms: roomRows,
  };
}

async function getRoomServiceQr(db, roomNumber) {
  const data = await listHotelQrs(db);
  const hit = data.rooms.find(
    (r) => String(r.room_number) === String(roomNumber),
  );
  if (!hit) throw new Error(`Dhoma ${roomNumber} nuk u gjet.`);
  return {
    business_name: data.business_name,
    base_url: data.base_url,
    ...hit.room_service,
    room_number: hit.room_number,
  };
}

function qrPrintHtml(codes, businessName = "", title = "QR Kodet") {
  const cards = (codes || []).map((c) => `
    <section class="qr-print-card">
      <img src="${c.data_url}" alt="${escHtml(c.label)}" width="280" height="280">
      <div class="qr-print-label">${escHtml(c.label)}</div>
      <div class="qr-print-url">${escHtml(c.url)}</div>
    </section>`).join("");

  return `<!DOCTYPE html>
<html lang="sq">
<head>
  <meta charset="UTF-8">
  <title>${escHtml(title)} — ${escHtml(businessName)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; margin: 0; padding: 16px; color: #111; }
    h1 { text-align: center; font-size: 1.25rem; margin: 0 0 1rem; }
    .qr-print-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
    .qr-print-card {
      border: 1px solid #ddd; border-radius: 12px; padding: 16px; text-align: center;
      page-break-inside: avoid; break-inside: avoid;
    }
    .qr-print-card img { display: block; margin: 0 auto 12px; }
    .qr-print-label { font-size: 1.35rem; font-weight: 800; margin-bottom: 6px; }
    .qr-print-url { font-size: 9px; color: #666; word-break: break-all; line-height: 1.3; }
    @media print {
      body { padding: 0; }
      .qr-print-grid { grid-template-columns: 1fr; }
      .qr-print-card {
        min-height: 100vh; display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        border: none; page-break-after: always;
      }
      .qr-print-card:last-child { page-break-after: auto; }
    }
  </style>
</head>
<body>
  <h1>${escHtml(title)}${businessName ? ` — ${escHtml(businessName)}` : ""}</h1>
  <div class="qr-print-grid">${cards}</div>
  <script>window.onload = () => { window.print(); };</script>
</body>
</html>`;
}

function setHotelQrBaseUrl(db, url) {
  const v = String(url || "").trim().replace(/\/+$/, "");
  if (v && !/^https?:\/\//i.test(v)) {
    throw new Error("URL bazë duhet të fillojë me http:// ose https://");
  }
  if (typeof db.setSetting === "function") {
    db.setSetting("hotel_qr_base_url", v);
  } else {
    throw new Error("setSetting nuk është i disponueshëm.");
  }
  return resolveQrBaseUrl(db);
}

module.exports = {
  listHotelQrs,
  getRoomServiceQr,
  qrPrintHtml,
  resolveQrBaseUrl,
  resolveHotelQrSlug,
  setHotelQrBaseUrl,
  buildHotelQrUrls,
  isCloudQrBase,
};
