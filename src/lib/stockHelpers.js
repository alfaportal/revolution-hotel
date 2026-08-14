function computeStockStatus(row) {
  if (!row.track_stock) return "unlimited";
  const q = Number(row.stock_quantity);
  if (!Number.isFinite(q) || q <= 0) return "out";
  const threshold = Number(row.stock_alert_threshold) || 5;
  if (q <= threshold) return "low";
  return "ok";
}

function isVisibleOnWebMenu(row) {
  if (row.active === false) return false;
  if (row.track_stock && Number(row.stock_quantity) <= 0) return false;
  return true;
}

function isOutOfStock(row) {
  return Boolean(row.track_stock) && Number(row.stock_quantity) <= 0;
}

module.exports = {
  computeStockStatus,
  isVisibleOnWebMenu,
  isOutOfStock,
};
