const { qrPngBuffer, assertSameOriginUrl } = require("./qrService");
const { buildTableMenuUrl, ensureKitchenCredentials } = require("../lib/kitchenAccess");
const { featuresForTier } = require("../lib/packages");
const { getClientById } = require("./salesService");
const { listVenue, loadAreasForClient } = require("./venueService");
const { buildTablesFromAreas } = require("../lib/tableLayout");

function tableMenuUrl(baseUrl, client, tableNumber) {
  return buildTableMenuUrl(baseUrl, client, tableNumber);
}

/** @deprecated — përdor tableMenuUrl; mbajtur për linket e vjetra me key */
function kioskTableUrl(baseUrl, client, tableNumber) {
  return tableMenuUrl(baseUrl, client, tableNumber);
}

async function resolveTableNumbers(clientId) {
  const areas = await loadAreasForClient(clientId);
  const venue = await listVenue(clientId);
  const layout = buildTablesFromAreas(areas, venue.table_count, null);
  let numbers = layout.tables.map(t => t.number);
  if (!numbers.length) {
    const count = Math.min(30, Math.max(1, Number(venue.table_count) || 10));
    numbers = Array.from({ length: count }, (_, i) => i + 1);
  }
  return numbers;
}

async function prepareKioskQrClient(clientId) {
  let client = await getClientById(clientId);
  if (!client) throw new Error("Klienti nuk u gjet.");
  client = await ensureKitchenCredentials(client);

  const features = featuresForTier(client.package_tier);
  if (!features.kiosk) {
    throw new Error("Paketa juaj nuk përfshin modulin Kiosk.");
  }

  return client;
}

async function buildTableQrEntry(base, client, table) {
  const url = tableMenuUrl(base, client, table);
  assertSameOriginUrl(url, base);
  const png = await qrPngBuffer(url, { width: 280 });
  const b64 = png.toString("base64");
  return {
    table,
    url,
    png_base64: b64,
    data_url: `data:image/png;base64,${b64}`,
  };
}

async function listTableQrMeta(clientId, baseUrl) {
  const client = await prepareKioskQrClient(clientId);
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const tables = await resolveTableNumbers(clientId);
  return {
    slug: client.kitchen_slug,
    business_name: client.emri || "",
    count: tables.length,
    tables: tables.map(table => ({
      table,
      url: tableMenuUrl(base, client, table),
    })),
  };
}

async function getTableQrCode(clientId, baseUrl, tableNumber) {
  const client = await prepareKioskQrClient(clientId);
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const table = Number(tableNumber);
  if (!table || table < 1) throw new Error("Numri i tavolinës është i pavlefshëm.");

  const allowed = await resolveTableNumbers(clientId);
  if (!allowed.includes(table)) {
    throw new Error(`Tavolina T${table} nuk ekziston në planin tuaj.`);
  }

  const entry = await buildTableQrEntry(base, client, table);
  return {
    slug: client.kitchen_slug,
    business_name: client.emri || "",
    ...entry,
  };
}

async function getTableQrPng(clientId, baseUrl, tableNumber) {
  const data = await getTableQrCode(clientId, baseUrl, tableNumber);
  return Buffer.from(data.png_base64, "base64");
}

async function listKioskQrCodes(clientId, baseUrl) {
  const client = await prepareKioskQrClient(clientId);
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const tables = await resolveTableNumbers(clientId);
  const codes = [];

  for (const table of tables) {
    codes.push(await buildTableQrEntry(base, client, table));
  }

  return {
    slug: client.kitchen_slug,
    count: codes.length,
    tables: codes,
  };
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

function singleQrPrintHtml(entry, businessName = "") {
  return qrPrintHtml([entry], businessName);
}

module.exports = {
  tableMenuUrl,
  kioskTableUrl,
  resolveTableNumbers,
  listTableQrMeta,
  getTableQrCode,
  getTableQrPng,
  listKioskQrCodes,
  qrPrintHtml,
  singleQrPrintHtml,
};
