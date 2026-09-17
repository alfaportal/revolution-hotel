const { getSupabase } = require("../db");
const {
  getSellerSnapshot,
  getInvoiceSettings,
  allocateInvoiceNumber,
} = require("./salesInvoiceService");

function mapItemsToInvoiceLines(items) {
  return (Array.isArray(items) ? items : [])
    .map((i) => ({
      description: String(i.name || i.emri || "").trim(),
      qty: Number(i.quantity) || 1,
      unitPrice: Number(i.price ?? i.cmimi ?? 0) || 0,
      discount: { type: "amount", value: 0 },
    }))
    .filter((ln) => ln.description);
}

async function loadClosedSale(clientId, saleOrderId) {
  const id = String(saleOrderId || "").trim();
  if (!id) throw new Error("Mungon ID e shitjes.");
  const db = getSupabase();
  const { data, error } = await db
    .from("sales_orders")
    .select("id, status, items_json, total, closed_at, table_number, receipt_number, payment_method")
    .eq("client_id", clientId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message || "Shitja nuk u lexua.");
  if (!data) throw new Error("Shitja nuk u gjet.");
  if (String(data.status || "").toLowerCase() !== "closed") {
    throw new Error("Shitja duhet të jetë e mbyllur para faturës A4.");
  }
  return data;
}

function invoiceDateFromSale(sale) {
  const raw = sale?.closed_at || new Date().toISOString();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/** Prefill faturë A4 nga shitja e mbyllur (waiter / recepsion). */
async function prefillFromSale(clientId, body = {}) {
  const saleOrderId = body.sale_order_id || body.order_id || body.saleOrderId;
  const sale = saleOrderId ? await loadClosedSale(clientId, saleOrderId) : null;
  const rawItems = Array.isArray(body.items) && body.items.length
    ? body.items
    : (sale?.items_json || []);
  const lines = mapItemsToInvoiceLines(rawItems);
  if (!lines.length) throw new Error("Nuk ka artikuj për faturën A4.");

  const [seller, settings] = await Promise.all([
    getSellerSnapshot(clientId),
    getInvoiceSettings(clientId),
  ]);

  return {
    seller,
    settings: {
      vatEnabled: settings.vatEnabled === true,
      vatPercent: Number(settings.vatPercent) || 18,
      companyLogoUrl: settings.companyLogoUrl || "",
    },
    lines,
    date: sale ? invoiceDateFromSale(sale) : new Date().toISOString().slice(0, 10),
    sale: sale
      ? {
          id: sale.id,
          total: Number(sale.total) || 0,
          table_number: sale.table_number,
          receipt_number: sale.receipt_number,
          payment_method: sale.payment_method,
          closed_at: sale.closed_at,
        }
      : null,
  };
}

async function allocateNumberForClient(clientId) {
  return allocateInvoiceNumber(clientId);
}

module.exports = {
  prefillFromSale,
  allocateNumberForClient,
  mapItemsToInvoiceLines,
};
