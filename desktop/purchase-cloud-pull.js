/**
 * Tërheq fatura blerjeje të skanuara nga telefon/owner AI dhe i regjistron lokalisht.
 * NUK prek sync të porosive — vetëm purchase_invoices + stock_qty.
 */
const cloudHealth = require("./cloud-health");

function getLicenseKey(db) {
  try {
    const license = require("./license");
    const eapp = (() => {
      try {
        return require("electron").app;
      } catch {
        return null;
      }
    })();
    const settingsKey = db.getSetting("cloud_license_key", "");
    const fileKey = eapp ? license.readStoredLicense(eapp) : "";
    return String(settingsKey || fileKey || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
  } catch {
    return "";
  }
}

function parseEuroNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 1000) / 1000;
  }
  let cleaned = String(value ?? "")
    .replace(/\s/g, "")
    .replace(/[^\d.,-]/g, "");
  if (cleaned.includes(",") && cleaned.includes(".")) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (cleaned.includes(",")) {
    cleaned = cleaned.replace(",", ".");
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : NaN;
}

/**
 * @returns {{ pulled: number, applied: number, errors: string[] }}
 */
async function pullAndApplyPendingPurchases(db) {
  const result = { pulled: 0, applied: 0, errors: [] };
  const celesi = getLicenseKey(db);
  if (!celesi) return result;

  let data;
  try {
    const res = await cloudHealth.requestJsonWithFallback(
      "GET",
      `/api/v1/pos/pending-purchases?celesi=${encodeURIComponent(celesi)}`,
      null,
      { timeoutMs: 30000, headers: { Accept: "application/json", "X-License-Key": celesi } },
    );
    data = JSON.parse(res.data || "{}");
    if (res.status >= 400) {
      result.errors.push(data.gabim || `HTTP ${res.status}`);
      return result;
    }
  } catch (err) {
    result.errors.push(err.message || String(err));
    return result;
  }

  const purchases = Array.isArray(data.purchases) ? data.purchases : [];
  result.pulled = purchases.length;
  if (!purchases.length) return result;

  const receiptScan = require("./ai/ai-receipt-scan");

  for (const row of purchases) {
    try {
      const items = (Array.isArray(row.items) ? row.items : []).map((it) => ({
        name: String(it.name || "").trim(),
        quantity: parseEuroNumber(it.quantity),
        unit: String(it.unit || it.njesia || "copë").trim() || "copë",
        pieces_per_pack: Number(it.pieces_per_pack) > 0 ? Number(it.pieces_per_pack) : undefined,
        unit_price: parseEuroNumber(it.unit_price ?? it.price),
      }));

      const applied = receiptScan.applyReceiptToStock(db, {
        supplier: row.supplier,
        invoice_number: row.invoice_number,
        invoice_date: row.invoice_date,
        items,
        from_cloud_queue: true,
        supplier_nui: row.supplier_nui,
        supplier_vat: row.supplier_vat,
        vat_rate: row.vat_rate,
        purchase_kind: row.purchase_kind,
      });

      await cloudHealth.requestJsonWithFallback(
        "POST",
        "/api/v1/pos/pending-purchases/applied",
        {
          celesi,
          id: row.id,
          applied_note: `local_invoice=${applied?.invoice?.id || ""} count=${applied.applied_count}`,
        },
        {
          timeoutMs: 20000,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-License-Key": celesi,
          },
        },
      );

      result.applied += 1;
      console.log(
        `[purchase-cloud] applied pending ${row.id} → invoice ${applied?.invoice?.id} (${applied.applied_count} items)`,
      );
    } catch (err) {
      const msg = err.message || String(err);
      result.errors.push(`${row.id}: ${msg}`);
      console.warn("[purchase-cloud] apply failed:", row.id, msg);

      // Nëse është duplikat lokal i njëjtës faturë — shëno applied që të mos rrijë pezull.
      if (/ekziston tashmë|dublikohet/i.test(msg)) {
        try {
          await cloudHealth.requestJsonWithFallback(
            "POST",
            "/api/v1/pos/pending-purchases/applied",
            { celesi, id: row.id, applied_note: `skip_duplicate: ${msg}` },
            {
              timeoutMs: 15000,
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "X-License-Key": celesi,
              },
            },
          );
        } catch {
          /* ignore */
        }
      }
    }
  }

  return result;
}

let _timer = null;

function startPendingPurchasePull(db, intervalMs = 45000) {
  if (_timer) return;
  const tick = () => {
    pullAndApplyPendingPurchases(db).catch((err) =>
      console.warn("[purchase-cloud] tick:", err.message),
    );
  };
  setTimeout(tick, 8000);
  _timer = setInterval(tick, intervalMs);
}

module.exports = {
  pullAndApplyPendingPurchases,
  startPendingPurchasePull,
  parseEuroNumber,
};
