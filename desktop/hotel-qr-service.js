/**
 * QR për hotel — Room Service / Menyja / Shërbime (vetëm cloud).
 * Publik: https://revolution-pos.com/hotel/menu/{slug}?room=…
 */
const QRCode = require("qrcode");
const {
  isLocalOrPrivateServerUrl,
  buildPublicMenuUrl,
  buildHotelGuestPublicUrl,
  PUBLIC_HOTEL_ORIGIN,
} = require("./cloud-server-url");

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

const CLOUD_QR_SETUP_MESSAGE = "Vendos çelësin te Admin → Cloud";

function resolveQrBaseUrl(db) {
  const slug = resolveHotelQrSlug(db);
  if (!slug) return "";
  const cloudDefault = String(PUBLIC_HOTEL_ORIGIN || "https://revolution-pos.com").replace(/\/+$/, "");
  let custom = "";
  try {
    custom = String(db.getSetting?.("hotel_qr_base_url", "") || "").trim();
  } catch {
    custom = "";
  }
  if (!custom || isLocalOrPrivateServerUrl(custom)) {
    return cloudDefault;
  }
  return custom.replace(/\/+$/, "");
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
  const roomRaw = String(roomNumber || "").trim();
  const roomEnc = encodeURIComponent(roomRaw);
  const venueSlug = String(slug || "").trim();

  if (isCloudQrBase(b) && venueSlug) {
    const tableSeg = roomRaw ? Math.max(1, Number(roomRaw.replace(/\D/g, "")) || 1) : 1;
    const menuUrl = buildPublicMenuUrl(b, venueSlug, tableSeg);
    const slugPart = venueSlug ? `&slug=${encodeURIComponent(venueSlug)}` : "";
    const menuWithRoom = roomRaw ? `${menuUrl}?room=${roomEnc}${slugPart}` : menuUrl;
    return {
      room_service: menuWithRoom,
      menu: menuWithRoom,
      services: buildHotelGuestPublicUrl(b, "services", roomRaw, venueSlug),
    };
  }

  return {
    room_service: room
      ? `${b}/guest/room-service.html?room=${room}`
      : `${b}/guest/room-service.html`,
    menu: room
      ? `${b}/guest/menu.html?room=${room}`
      : `${b}/guest/menu.html`,
    services: room
      ? `${b}/guest/services.html?room=${room}`
      : `${b}/guest/services.html`,
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
  const slug = resolveHotelQrSlug(db);
  const business_name =
    (typeof db.getBusinessName === "function" ? db.getBusinessName() : "")
    || settings.business_name
    || settings.restaurant_name
    || "Hotel";

  if (!slug) {
    return {
      base_url: "",
      configured_base_url: "",
      qr_mode: "needs_cloud",
      cloud_setup_message: CLOUD_QR_SETUP_MESSAGE,
      hotel_slug: "",
      business_name,
      count: 0,
      shared: { menu: null, services: null },
      rooms: [],
    };
  }

  const configuredBase = resolveQrBaseUrl(db);
  const useCloudQr = isCloudQrBase(configuredBase) && !!slug;
  const qrBase = useCloudQr ? configuredBase : "";
  if (!qrBase) {
    return {
      base_url: "",
      configured_base_url: configuredBase,
      qr_mode: "needs_cloud",
      cloud_setup_message: CLOUD_QR_SETUP_MESSAGE,
      hotel_slug: slug,
      business_name,
      count: 0,
      shared: { menu: null, services: null },
      rooms: [],
    };
  }
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
    const menuForRoom = await qrEntry(
      "menu",
      `Menyja — Dh. ${room.room_number}`,
      urls.menu,
    );
    const svcForRoom = await qrEntry(
      "services",
      `Shërbime — Dh. ${room.room_number}`,
      urls.services,
    );
    roomRows.push({
      room_id: room.id,
      room_number: room.room_number,
      floor: room.floor,
      type: room.type,
      room_service: rs,
      menu: menuForRoom,
      services: svcForRoom,
    });
  }

  return {
    base_url: qrBase,
    configured_base_url: configuredBase,
    qr_mode: "cloud",
    hotel_slug: slug,
    business_name,
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
  if (v && isLocalOrPrivateServerUrl(v)) {
    throw new Error("QR cloud: përdor URL publike (revolution-pos.com), jo LAN ose localhost.");
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
  CLOUD_QR_SETUP_MESSAGE,
};
