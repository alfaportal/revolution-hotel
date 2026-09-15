const { v4: uuidv4 } = require("uuid");
const { normalizeItems, updateActiveSaleFromPos } = require("./salesService");
const { getLicenseForClient, cancelTableOrder } = require("./waiterService");
const { WEB_KIOSK } = require("../lib/orderSource");
const { getClientMenuCatalog } = require("./menuCatalogService");

const KIOSK_DEVICE = WEB_KIOSK;

function tableWaiterLabel(tableNumber) {
  return `QR · T${tableNumber}`;
}

async function getKioskMenu(clientId, { kitchenSlug = "", channel = "kiosk" } = {}) {
  return getClientMenuCatalog(clientId, {
    activeOnly: true,
    kitchenSlug,
    channel,
  });
}

async function submitKioskOrder(client, body) {
  const tableNumber = Number(body.table_number);
  if (!tableNumber || tableNumber < 1) {
    throw new Error("Mungon numri i tavolinës (?table=... në link).");
  }

  const newItems = normalizeItems(body.items);
  if (!newItems.length) throw new Error("Shtoni të paktën një artikull.");

  const total = newItems.reduce((s, i) => s + i.price * i.quantity, 0);
  const now = new Date().toISOString();
  const license = await getLicenseForClient(client.id);
  const localOrderId = `kiosk-${uuidv4()}`;
  const waiterName = tableWaiterLabel(tableNumber);

  const sale = await updateActiveSaleFromPos({
    celesi: license.celesi,
    device_id: KIOSK_DEVICE,
    local_order_id: localOrderId,
    table_number: tableNumber,
    waiter_name: waiterName,
    items: newItems,
    total,
    status: "ordered",
    ordered_at: now,
  });

  try {
    const { deductStockForOrder } = require("./stockService");
    await deductStockForOrder(client.id, newItems);
  } catch (err) {
    console.warn("[stock] kiosk deduct failed:", err.message);
  }

  try {
    const { deductIngredientsForOrder } = require("./inventoryService");
    await deductIngredientsForOrder(client.id, newItems);
  } catch (err) {
    console.warn("[inventory] kiosk deduct failed:", err.message);
  }

  return {
    ok: true,
    order: sale,
    client_name: client.emri,
    sent_to: "bar",
    table_number: tableNumber,
  };
}

async function cancelKioskOrder(client, body) {
  const tableNumber = Number(body.table_number);
  if (!tableNumber || tableNumber < 1) {
    throw new Error("Mungon numri i tavolinës.");
  }
  const { getActiveTableOrders } = require("./waiterService");
  const active = await getActiveTableOrders(client.id);
  const existing = active.get(tableNumber);
  const sale = await cancelTableOrder(client.id, { tableNumber, existing });
  return {
    ok: true,
    message: "Porosia u anullua",
    order: sale,
    table_number: tableNumber,
  };
}

module.exports = {
  getKioskMenu,
  submitKioskOrder,
  cancelKioskOrder,
};
