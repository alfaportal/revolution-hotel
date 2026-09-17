/**
 * One-off sync: blloqe admin.html nga KAFENE → HOTEL (blerje/stok/skann).
 * Ekzekuto: node scripts/_patch-admin-from-kafene.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hotelAdmin = path.join(__dirname, "..", "public", "admin.html");
const kafeneAdmin = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "RESTAURANT",
  "restaurant-system",
  "KAFENE",
  "public",
  "admin.html",
);

function lines(p) {
  return fs.readFileSync(p, "utf8").split(/\r?\n/);
}

function slice(arr, start1, end1) {
  return arr.slice(start1 - 1, end1).join("\n");
}

function replaceBetween(content, startMarker, endMarker, insert) {
  const a = content.indexOf(startMarker);
  const b = content.indexOf(endMarker, a + startMarker.length);
  if (a < 0 || b < 0) throw new Error(`Markers not found: ${startMarker} / ${endMarker}`);
  return content.slice(0, a) + insert + content.slice(b);
}

const k = lines(kafeneAdmin);
let h = fs.readFileSync(hotelAdmin, "utf8");

// modal-stock-add
const stockModal = slice(k, 3766, 3790);
h = replaceBetween(
  h,
  '  <div id="modal-reservation" class="table-modal" hidden>',
  '  <div id="modal-reservation" class="table-modal" hidden>',
  stockModal + "\n\n  ",
);

// modal-receipt-scan (foto 1+2, TVSH kolonë)
const receiptModal = slice(k, 4035, 4125);
h = replaceBetween(
  h,
  '  <div id="modal-receipt-scan" class="table-modal" hidden>',
  '  <div id="modal-purchase" class="table-modal" hidden>',
  receiptModal + "\n\n  ",
);

// stock JS after stokuCatFilter
const stockJs = slice(k, 5710, 5817);
h = replaceBetween(
  h,
  "    let stokuCatFilter = undefined;",
  "\n    function escMenuAttr(s) {",
  "    let stokuCatFilter = undefined;\n" + stockJs + "\n\n    function escMenuAttr(s) {",
);

// confirmDuplicate + ruajFaturen duplicate block - insert before ruajFaturenBlerje
const confirmDup = slice(k, 7273, 7287);
const ruajDupBlock = slice(k, 7340, 7375);
if (!h.includes("function confirmDuplicatePurchaseInvoiceUse")) {
  h = h.replace(
    "    async function ruajFaturenBlerje() {",
    confirmDup + "\n\n    async function ruajFaturenBlerje() {",
  );
}
if (!h.includes("/api/purchases/check-duplicate")) {
  h = h.replace(
    "      purchaseSaving = true;\n      document.getElementById(\"purchase-modal-save\").disabled = true;\n      try {\n        const payload = {",
    `      const editingId = purchaseEditingId;\n      let allowDuplicatePurchase = false;\n      if (!editingId && invoice_number) {\n        try {\n          const dupCheck = await api("/api/purchases/check-duplicate", {\n            method: "POST",\n            body: JSON.stringify({ supplier, invoice_number }),\n          });\n          if (dupCheck.duplicate_of) {\n            if (!confirmDuplicatePurchaseInvoiceUse(invoice_number, supplier, dupCheck.duplicate_of)) {\n              msg.textContent = "Ruajtja u anulua — fatura me këtë numër është regjistruar më parë.";\n              msg.style.color = "var(--ngjyr-danger)";\n              return;\n            }\n            allowDuplicatePurchase = true;\n          }\n        } catch (err) {\n          msg.textContent = err.message || "Gabim kontrolli dublikatës";\n          msg.style.color = "var(--ngjyr-danger)";\n          return;\n        }\n      }\n\n      purchaseSaving = true;\n      document.getElementById("purchase-modal-save").disabled = true;\n      try {\n        const payload = {`,
  );
  h = h.replace(
    "          items,\n        };\n        if (isAdj) {",
    "          items,\n        };\n        if (allowDuplicatePurchase) payload.allow_duplicate = true;\n        if (isAdj) {",
  );
}

// receipt scan JS block
const receiptJs = slice(k, 8713, 9295);
h = replaceBetween(
  h,
  "    let receiptScanItems = [];",
  "    document.getElementById(\"btn-menu-scan-ai\")?.addEventListener(\"click\", openMenuScanModal);",
  receiptJs + "\n\n    ",
);

// stoku panel subtitle + grid card + handler
h = h.replace(
  `<p class="purchases-panel-sub">Shitja zbret stokun · blerja e rrit · stoku 0 → alarm. Blerjet / fatura: te skeda Blerjet.</p>`,
  `<p class="purchases-panel-sub">Shitja zbret stokun · «+ Shto stok» rrit stokun dhe regjistron blerje (Blerjet + Kontabilisti) · stoku 0 → alarm.</p>`,
);

h = h.replace(
  `    /** Paralajmërim: /api/stock/add — kontabilisti kërkon faturë blerjeje; reconciliacioni e njeh shtesën manuale. */
    const SHTES_MANUALE_STOKU_KONTABILIST_MSG =
      "⚠️ Shtesa manuale (+ Shto stok) regjistrohet për verifikimin e stokut, por jo te Kontabilisti — për blerje zyrtare përdorni Blerjet.";

`,
  "",
);

h = h.replace(
  `<div class="product-card-meta"><span class="product-card-stock">Stoku: ${stockLabel}${stockBadge}</span></div>
              <div class="product-card-price">${formatEuro(it.price)}</div>`,
  `<div class="product-card-meta"><span class="product-card-stock">Stoku: ${stockLabel}${stockBadge}</span></div>
              <div class="product-card-meta" style="font-size:0.78rem;color:var(--ngjyr-muted)">
                Blerje: ${formatEuro(Number(it.cost_price) || 0)} · Shitje: ${formatEuro(it.price)}
              </div>
              <div class="product-card-price">${formatEuro(it.price)}</div>`,
);

h = replaceBetween(
  h,
  "      grid.querySelectorAll(\"[data-stock-add]\").forEach((btn) => {",
  "      });\n    }\n\n    async function ngarkoMenu(keepEditingId = null) {",
  `      grid.querySelectorAll("[data-stock-add]").forEach((btn) => {
        btn.addEventListener("click", () => {
          openStockAddModal(Number(btn.dataset.stockAdd));
        });
      });
`,
);

// stock modal listeners near reservation
if (!h.includes('getElementById("stock-add-save")')) {
  h = h.replace(
    '    document.getElementById("reservation-modal-cancel")?.addEventListener("click", mbyllModalRezervim);',
    `    document.getElementById("stock-add-cancel")?.addEventListener("click", closeStockAddModal);
    document.getElementById("stock-add-backdrop")?.addEventListener("click", closeStockAddModal);
    document.getElementById("stock-add-save")?.addEventListener("click", () => {
      submitStockAddFromModal().catch((err) => {
        const msg = document.getElementById("stock-add-msg");
        if (msg) {
          msg.textContent = err.message || "Gabim";
          msg.style.color = "var(--ngjyr-danger)";
        }
      });
    });
    document.getElementById("reservation-modal-cancel")?.addEventListener("click", mbyllModalRezervim);`,
  );
}

fs.writeFileSync(hotelAdmin, h, "utf8");
console.log("Patched", hotelAdmin);
