const { resolveOwnerEmail } = require("./stockService");
const { isEmailConfigured, sendShiftCloseReportEmail } = require("./emailService");

function formatShiftDate(raw) {
  const s = String(raw || "").trim();
  if (!s) {
    return new Date().toISOString().slice(0, 10);
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return s.slice(0, 10);
}

/**
 * Dërgon emailin e raportit ditor te pronari pas mbylljes së ndërrimit nga KAFENE.
 * Nuk hedh gabim nëse mungon email / Resend — kthen { ok, skipped }.
 */
async function sendShiftCloseEmailForClient(client, body = {}) {
  if (!isEmailConfigured()) {
    return { ok: true, skipped: true, reason: "email_not_configured" };
  }

  const ownerEmail = await resolveOwnerEmail(client.id, client);
  if (!ownerEmail) {
    return { ok: true, skipped: true, reason: "no_owner_email" };
  }

  const restaurantName =
    String(body.restaurant_name || client.emri || "").trim() || client.emri || "Lokal";
  const shiftDate = formatShiftDate(body.shift_date || body.closed_at || body.opened_at);

  await sendShiftCloseReportEmail({
    to: ownerEmail,
    clientName: restaurantName,
    waiterName: body.waiter_name,
    shiftDate,
    totalSales: body.total_sales,
    orderCount: body.order_count,
    cashTotal: body.cash_total,
    cardTotal: body.card_total,
    lowStockItems: body.low_stock_items,
  });

  return { ok: true, emailed: ownerEmail };
}

module.exports = {
  sendShiftCloseEmailForClient,
  formatShiftDate,
};
