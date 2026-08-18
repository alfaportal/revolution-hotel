const QRCode = require("qrcode");
const { normalizeCloudServerUrl, getPublicCloudServerUrl } = require("./cloud-server-url");

function buildTableMenuUrl(baseUrl, slug, tableNumber) {
  const base = normalizeCloudServerUrl(baseUrl).replace(/\/+$/, "");
  const table = Math.max(1, Number(tableNumber) || 1);
  return `${base}/menu/${encodeURIComponent(String(slug || "").trim())}/${table}`;
}

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function qrPrintHtml(codes, businessName = "") {
  const cards = (codes || []).map(c => `
    <section class="qr-print-card">
      <img src="${c.data_url}" alt="QR Tavolina ${c.table}" width="280" height="280">
      <div class="qr-print-label">Tavolina ${c.table}</div>
      <div class="qr-print-url">${escHtml(c.url)}</div>
    </section>`).join("");

  return `<!DOCTYPE html>
<html lang="sq">
<head>
  <meta charset="UTF-8">
  <title>QR Kodet — ${escHtml(businessName)}</title>
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
    .qr-print-label { font-size: 1.75rem; font-weight: 800; margin-bottom: 6px; }
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
  <h1>QR Kodet e tavolinave${businessName ? ` — ${escHtml(businessName)}` : ""}</h1>
  <div class="qr-print-grid">${cards}</div>
  <script>window.onload = () => { window.print(); };</script>
</body>
</html>`;
}

async function buildTableQrEntry(baseUrl, slug, table) {
  const url = buildTableMenuUrl(baseUrl, slug, table);
  const png = await QRCode.toBuffer(url, { width: 280, margin: 1 });
  const b64 = png.toString("base64");
  return {
    table,
    url,
    png_base64: b64,
    data_url: `data:image/png;base64,${b64}`,
  };
}

async function verifyVenueSlugOnCloud(slug) {
  const base = getPublicCloudServerUrl();
  const path = `/api/menu/${encodeURIComponent(String(slug || "").trim())}/menu`;
  const cloudHealth = require("./cloud-health");
  try {
    const res = await cloudHealth.requestJsonOnce("GET", base, path, null, 12000);
    if (res.status >= 400) return { ok: false };
    let parsed = {};
    try {
      parsed = JSON.parse(res.data || "{}");
    } catch {
      return { ok: false };
    }
    return { ok: parsed.ok !== false, client_name: parsed.client_name || parsed.restaurant_name || "" };
  } catch {
    return { ok: false };
  }
}

/**
 * Merr slug të verifikuar nga cloud (pas validimit të licencës).
 * Mos përdor ID/slug të vjetër të ruajtur lokalisht pa e testuar në server.
 */
async function resolveQrVenueSlug(db) {
  const cloudSync = require("./cloud-sync");
  const cloudHealth = require("./cloud-health");

  if (!cloudHealth.getHealthStatus().online) {
    throw new Error(
      "Cloud offline — hoteli punon vetëm me SQLite lokal.",
    );
  }

  const status = await cloudSync.checkConnection(db);
  if (!status.connected) {
    throw new Error(status.message || "Licenca nuk u validua — kontrolloni çelësin te Cilësimet → Cloud.");
  }

  const cloud = db.getCloudSettings();
  const candidates = [
    cloud.kitchen_slug,
    status.kitchen_slug,
    cloud.cloud_client_id,
    status.client_id,
  ]
    .map(s => String(s || "").trim())
    .filter(Boolean);

  const seen = new Set();
  for (const slug of candidates) {
    if (seen.has(slug)) continue;
    seen.add(slug);
    const verified = await verifyVenueSlugOnCloud(slug);
    if (verified.ok) {
      db.updateKitchenAccess({
        kitchen_slug: status.kitchen_slug || cloud.kitchen_slug || slug,
        kitchen_key: status.kitchen_key || cloud.kitchen_key,
        client_id: status.client_id || cloud.cloud_client_id,
        client_name: status.client_name || cloud.cloud_client_name,
      });
      return slug;
    }
  }

  throw new Error(
    "Lokali nuk u gjet në cloud — ID e vjetër në PC. Te Cloud bëni «Sinkronizo gjithçka», pastaj «Rigjenero QR nga cloud».",
  );
}

async function listTableQrs(db, { refreshFromCloud = true } = {}) {
  const settings = db.getSettings();
  const slug = refreshFromCloud
    ? await resolveQrVenueSlug(db)
    : (db.getCloudSettings().kitchen_slug || db.getCloudSettings().cloud_client_id || "");

  if (!slug) {
    throw new Error("Lidhuni me cloud-in (Cilësimet → Cloud) për të gjeneruar QR kodet.");
  }

  const publicBase = getPublicCloudServerUrl();
  const rows = db.getTablesWithOrders();
  const tables = [];
  for (const row of rows) {
    tables.push(await buildTableQrEntry(publicBase, slug, row.number));
  }
  const cloud = db.getCloudSettings();
  return {
    slug,
    client_id: cloud.cloud_client_id || "",
    kitchen_slug: cloud.kitchen_slug || "",
    count: tables.length,
    business_name: settings.restaurant_name || cloud.cloud_client_name || "",
    tables,
  };
}

async function regenerateTableQrs(db) {
  const cloudSync = require("./cloud-sync");
  await cloudSync.fullCloudSync(db);
  return listTableQrs(db, { refreshFromCloud: true });
}

async function getTableQrPng(db, tableNumber) {
  const data = await getTableQr(db, tableNumber);
  return Buffer.from(data.png_base64, "base64");
}

async function getTableQr(db, tableNumber) {
  const settings = db.getSettings();
  const slug = await resolveQrVenueSlug(db);
  const table = Number(tableNumber);
  const row = db.getTablesWithOrders().find(t => Number(t.number) === table);
  if (!row) {
    throw new Error(`Tavolina T${table} nuk ekziston.`);
  }
  const entry = await buildTableQrEntry(getPublicCloudServerUrl(), slug, table);
  const cloud = db.getCloudSettings();
  return {
    slug,
    business_name: settings.restaurant_name || cloud.cloud_client_name || "",
    label: row.label || `Tavolina ${table}`,
    ...entry,
  };
}

module.exports = {
  listTableQrs,
  regenerateTableQrs,
  resolveQrVenueSlug,
  getTableQr,
  getTableQrPng,
  qrPrintHtml,
  buildTableMenuUrl,
};
