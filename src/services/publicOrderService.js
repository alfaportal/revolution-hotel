const { v4: uuidv4 } = require("uuid");
const { normalizeItems, updateActiveSaleFromPos } = require("./salesService");
const { getLicenseForClient } = require("./waiterService");
const { WEB_PUBLIC, publicOrderWaiterLabel } = require("../lib/orderSource");
const { clientHasFeature, packageUpgradeMessage } = require("../lib/packages");

function normalizeOrderType(raw) {
  const t = String(raw || "takeaway").trim().toLowerCase();
  return t === "delivery" ? "delivery" : "takeaway";
}

async function submitPublicOrder(client, body) {
  if (!clientHasFeature(client, "online_orders")) {
    const err = new Error(packageUpgradeMessage("online_orders"));
    err.code = "PACKAGE";
    throw err;
  }

  const customerName = String(body.customer_name || body.name || "").trim();
  const customerPhone = String(body.customer_phone || body.phone || "").trim();
  const orderType = normalizeOrderType(body.order_type);
  const deliveryAddress = String(body.delivery_address || "").trim();

  if (!customerName) throw new Error("Vendosni emrin tuaj.");
  if (!customerPhone || customerPhone.replace(/\D/g, "").length < 6) {
    throw new Error("Vendosni numrin e telefonit.");
  }
  if (orderType === "delivery" && !deliveryAddress) {
    throw new Error("Vendosni adresën e dërgesës.");
  }

  let items = normalizeItems(body.items);
  if (!items.length) throw new Error("Shtoni të paktën një artikull.");

  if (orderType === "delivery") {
    items = [
      { name: `📍 Adresa: ${deliveryAddress}`, quantity: 1, price: 0 },
      ...items,
    ];
  }

  const total = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const license = await getLicenseForClient(client.id);
  const localOrderId = `public-${uuidv4()}`;
  const now = new Date().toISOString();
  const waiterName = publicOrderWaiterLabel(orderType, customerName, customerPhone, deliveryAddress);

  const sale = await updateActiveSaleFromPos({
    celesi: license.celesi,
    device_id: WEB_PUBLIC,
    local_order_id: localOrderId,
    table_number: 0,
    waiter_name: waiterName,
    items,
    total,
    status: "ordered",
    ordered_at: now,
  });

  try {
    const { deductStockForOrder } = require("./stockService");
    const menuItems = items.filter(it => !String(it.name || "").startsWith("📍") && Number(it.price) > 0);
    await deductStockForOrder(client.id, menuItems);
  } catch (err) {
    console.warn("[stock] public order deduct failed:", err.message);
  }

  try {
    const { deductIngredientsForOrder } = require("./inventoryService");
    const menuItems = items.filter(it => !String(it.name || "").startsWith("📍") && Number(it.price) > 0);
    await deductIngredientsForOrder(client.id, menuItems);
  } catch (err) {
    console.warn("[inventory] public order deduct failed:", err.message);
  }

  return {
    ok: true,
    order: sale,
    order_type: orderType,
    customer_name: customerName,
    delivery_address: orderType === "delivery" ? deliveryAddress : "",
    sent_to: "bar",
  };
}

module.exports = {
  submitPublicOrder,
  normalizeOrderType,
};
