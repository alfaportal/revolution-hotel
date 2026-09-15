const { formatItemLine, formatTotalLine, formatReceiptDateTime } = require("./receipt-text");

function itemKey(it) {
  const id = it?.menu_item_id;
  if (id != null && String(id).trim() !== "") return `id:${String(id)}`;
  const price = Number(it?.price);
  const normPrice = Number.isFinite(price) ? price.toFixed(2) : "0.00";
  return `n:${String(it?.name || "").trim().toLowerCase()}|${normPrice}`;
}

/** Bashkon artikujt e tavolinës me porosinë e re (shton sasitë). */
function mergeOrderItems(base, added) {
  const map = new Map();
  for (const it of [...(base || []), ...(added || [])]) {
    const k = itemKey(it);
    const qty = Number(it.quantity) || 0;
    if (qty <= 0) continue;
    const prev = map.get(k);
    if (prev) {
      prev.quantity = (Number(prev.quantity) || 0) + qty;
    } else {
      map.set(k, {
        menu_item_id: it.menu_item_id,
        name: it.name,
        price: Number(it.price) || 0,
        quantity: qty,
      });
    }
  }
  return [...map.values()];
}

/** Vetëm artikujt e shtuar në këtë dërgim — jo e gjithë porosia e tavolinës. */
function diffOrderItems(previous, incoming) {
  const prevMap = new Map();
  for (const it of previous || []) {
    const k = itemKey(it);
    prevMap.set(k, (prevMap.get(k) || 0) + (Number(it.quantity) || 0));
  }
  const delta = [];
  for (const it of incoming || []) {
    const k = itemKey(it);
    const prevQty = prevMap.get(k) || 0;
    const newQty = Number(it.quantity) || 0;
    const added = newQty - prevQty;
    if (added > 0) {
      delta.push({
        menu_item_id: it.menu_item_id,
        name: it.name,
        price: it.price,
        quantity: added,
      });
    }
  }
  return delta;
}

function formatEuro(n) {
  return Number(n || 0).toFixed(2) + " EUR";
}

function buildKitchenTicketHtml({
  restaurantName,
  tableNumber,
  waiterName,
  acceptedBy = "",
  items,
  fiscal = {},
  paper = "80mm",
  batchNumber = 0,
  slipKind = "porosi",
}) {
  const { date, time } = formatReceiptDateTime(new Date().toISOString());
  const bizName = String(fiscal.biz_name || restaurantName || "Lokal").trim();
  const addrLine = [fiscal.biz_address, fiscal.biz_city].filter(Boolean).join(", ");
  const w = paper === "58mm" ? 32 : 48;

  const batchTotal = (items || []).reduce(
    (s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 0),
    0,
  );

  const slipTitle =
    slipKind === "fature"
      ? "FATURË PËRFUNDIMTARE"
      : batchNumber > 0
        ? `POROSI #${batchNumber}`
        : "POROSI";

  const itemLines = (items || [])
    .map(it => {
      const textLine = formatItemLine(it, w);
      return `<div class="receipt-meta receipt-mono">${textLine}</div>`;
    })
    .join("");

  const totalLine = formatTotalLine(batchTotal, w);

  return `
    <div class="receipt-rule">================================</div>
    <div class="receipt-name">${bizName}</div>
    ${addrLine ? `<div class="receipt-meta">${addrLine}</div>` : ""}
    ${fiscal.biz_phone ? `<div class="receipt-meta">Tel: ${fiscal.biz_phone}</div>` : ""}
    <div class="receipt-rule">================================</div>
    <div class="receipt-body">
      <div class="receipt-meta receipt-mono" style="text-align:center;font-weight:800">${slipTitle}</div>
      ${slipKind === "porosi" ? '<div class="receipt-meta" style="text-align:center;font-size:0.85em">(jo faturë përfundimtare)</div>' : ""}
      <div class="receipt-meta">Tavolina: T${tableNumber}</div>
      <div class="receipt-meta">Klienti: ${waiterName || "—"}</div>
      ${acceptedBy ? `<div class="receipt-meta">Pranuar nga: ${acceptedBy}</div>` : ""}
      ${fiscal.biz_register_number ? `<div class="receipt-meta">Arka: ${fiscal.biz_register_number}</div>` : ""}
      <div class="receipt-meta">Data: ${date}  Ora: ${time}</div>
      <div class="receipt-rule">--------------------------------</div>
      ${itemLines || '<div class="receipt-meta">— pa artikuj —</div>'}
      <div class="receipt-rule">--------------------------------</div>
      <div class="receipt-meta receipt-mono">${totalLine}</div>
      <div class="receipt-rule">================================</div>
    </div>`;
}

module.exports = { buildKitchenTicketHtml, diffOrderItems, mergeOrderItems, formatEuro };
