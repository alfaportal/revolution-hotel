/**
 * fiscal/fiscal-line-discount.js — zbritje për rresht artikulli (4 dec).
 * Përdoret nga atk-model-builder për CouponItem.discount dhe totalDiscount.
 */
const { round4, lineTotalAmount, normalizeQty, normalizeUnitPrice } = require("./fiscal-vat");

function resolveLineDiscountAmount(item) {
  if (!item || typeof item !== "object") return 0;
  const raw =
    item.line_discount_amount ??
    item.lineDiscountAmount ??
    item.item_discount ??
    item.discount_line ??
    0;
  const n = round4(Number(raw) || 0);
  return n < 0 ? 0 : n;
}

function resolveLineSurchargeAmount(item) {
  if (!item || typeof item !== "object") return 0;
  const raw =
    item.line_surcharge_amount ??
    item.lineSurchargeAmount ??
    item.item_surcharge ??
    0;
  const n = round4(Number(raw) || 0);
  return n < 0 ? 0 : n;
}

function grossLineAmount(item) {
  const qty = normalizeQty(item?.quantity ?? item?.qty ?? 1);
  const unit = normalizeUnitPrice(item);
  return lineTotalAmount(qty, unit);
}

function netLineAmount(item) {
  const gross = grossLineAmount(item);
  const discount = resolveLineDiscountAmount(item);
  const surcharge = resolveLineSurchargeAmount(item);
  const net = round4(gross - discount + surcharge);
  return net < 0 ? 0 : net;
}

function sumLineDiscountAmounts(items) {
  const list = Array.isArray(items) ? items : [];
  return round4(list.reduce((s, it) => s + resolveLineDiscountAmount(it), 0));
}

function computeCouponTotalDiscount(receiptRow, items) {
  const list = Array.isArray(items) ? items : [];
  const cartDiscount = round4(Number(receiptRow?.discount_amount ?? 0) || 0);
  const lineDiscount = sumLineDiscountAmounts(list);
  if (receiptRow?.total_discount_amount != null) {
    return round4(Number(receiptRow.total_discount_amount) || 0);
  }
  return round4(cartDiscount + lineDiscount);
}

module.exports = {
  resolveLineDiscountAmount,
  resolveLineSurchargeAmount,
  grossLineAmount,
  netLineAmount,
  sumLineDiscountAmounts,
  computeCouponTotalDiscount,
};
