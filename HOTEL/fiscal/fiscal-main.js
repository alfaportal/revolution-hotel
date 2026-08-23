/**
 * fiscal/fiscal-main.js — HAPI FINAL: lidhja e moduleve fiskale PAS closeTable.
 * NUK thërret / NUK ndryshon closeTable. Kur isFiscalEnabled()=false → null.
 */
const { isFiscalEnabled, getFiscalSettings } = require("./fiscal-config");
const {
  getNextDailyNumber,
  getNextTotalNumber,
  generateNUIKF,
  getSefIdentifier,
} = require("./fiscal-numbering");
const {
  calculateVatBreakdown,
  calculateVatTaxBreakdown,
  getVatRate,
  getVatNormLetter,
  round4,
  normalizeQty,
  normalizeUnitPrice,
} = require("./fiscal-vat");
const { signReceipt } = require("./fiscal-crypto");
const { generateFiscalQR } = require("./fiscal-qr");
const { generateFiscalReceipt } = require("./fiscal-print");
const { syncLanguageFromSettings } = require("./fiscal-i18n");
const {
  checkInternetConnection,
  queueOfflineReceipt,
} = require("./fiscal-offline");
const { logFiscalAction } = require("./fiscal-audit");
const {
  insertFiscalReceipt,
  validateFiscalReceiptInsert,
  getFiscalReceiptById,
} = require("./fiscal-db");
const { attachChainToFiscalData } = require("./fiscal-hash-chain");
const { getFiscalTodayParts } = require("./fiscal-time-sync");

const PRINT_MODE_KEY = "sef_print_mode"; // addon | replace

function getSqlite() {
  const database = require("../database");
  if (!database || !database.db) {
    throw new Error("Databaza nuk është e gatshme");
  }
  return database.db;
}

function getDbApi() {
  return require("../database");
}

function tryBackfillDailyLogReceipt(orderId, { nuikf, fiscal_receipt_id } = {}) {
  try {
    const dbApi = getDbApi();
    if (typeof dbApi.backfillDailyLogReceiptForOrder === "function") {
      return dbApi.backfillDailyLogReceiptForOrder(orderId, { nuikf, fiscal_receipt_id });
    }
  } catch (e) {
    console.warn("[fiscal-main] daily_log backfill:", e.message);
  }
  return { updated: 0 };
}

/** addon = kupon normal + fiskal; replace = vetëm fiskal (default). */
function getFiscalPrintMode() {
  try {
    const dbApi = getDbApi();
    // Migrim një herë: default i vjetër "addon" → "replace" (vetëm kupon fiskal)
    if (String(dbApi.getSetting("sef_print_mode_migrated_v212", "0")) !== "1") {
      dbApi.setSetting(PRINT_MODE_KEY, "replace");
      dbApi.setSetting("sef_print_mode_migrated_v212", "1");
      return "replace";
    }
    const v = String(dbApi.getSetting(PRINT_MODE_KEY, "replace") || "replace")
      .trim()
      .toLowerCase();
    return v === "addon" ? "addon" : "replace";
  } catch {
    return "replace";
  }
}

function setFiscalPrintMode(mode) {
  const v = String(mode || "").toLowerCase() === "addon" ? "addon" : "replace";
  getDbApi().setSetting(PRINT_MODE_KEY, v);
  return v;
}

/**
 * Vetëm për kuponin e MBYLLJES (closing receipt / faturë).
 * ASNJËHERË për kuponin e porosisë (order ticket / bar / kuzhinë).
 * - fiscal OFF → true (printo kuponin normal të mbylljes)
 * - fiscal ON + addon → true (normal + fiskal)
 * - fiscal ON + replace → false (vetëm kupon fiskal në mbyllje)
 */
function shouldPrintClosingNormalReceipt() {
  if (!isFiscalEnabled()) return true;
  return getFiscalPrintMode() === "addon";
}

/** Alias — i njëjti kuptim: vetëm mbyllja, JO order ticket. */
function shouldPrintNormalReceipt() {
  return shouldPrintClosingNormalReceipt();
}

function todayParts() {
  return getFiscalTodayParts();
}

function parseItems(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const p = JSON.parse(raw || "[]");
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

/**
 * Mapo vat_category menu (0/8/18) → shkronjë A/D/E.
 * Pa këtë, krejt artikujt bëhen E dhe mungon TVSH D në kupon.
 */
function resolveItemVatNorm(item, vatByMenuId) {
  const direct = String(item?.vat_norm || item?.vat_letter || "")
    .trim()
    .toUpperCase();
  if (/^[A-E]$/.test(direct)) return direct;

  const pctRaw =
    item?.vat_category ??
    item?.vat_rate ??
    item?.vat_percent ??
    item?.tvsh_percent ??
    null;
  if (pctRaw != null && String(pctRaw).trim() !== "") {
    const fromPct = getVatNormLetter(pctRaw);
    if (fromPct) return fromPct;
  }

  const mid = item?.menu_item_id != null ? Number(item.menu_item_id) : null;
  if (mid != null && vatByMenuId && vatByMenuId.has(mid)) {
    const fromMenu = getVatNormLetter(vatByMenuId.get(mid));
    if (fromMenu) return fromMenu;
  }

  return "E";
}

function normalizeDiscountMeta(raw) {
  if (!raw || typeof raw !== "object") return null;
  const type = String(raw.type || "")
    .trim()
    .toLowerCase();
  const value = Number(raw.value);
  if (!type || type === "none" || !Number.isFinite(value) || value <= 0) return null;
  return { type, value };
}

function pickLineDiscountMeta(item) {
  if (!item || typeof item !== "object") return null;
  const fromObj = normalizeDiscountMeta(item.line_discount);
  if (fromObj) return fromObj;
  return normalizeDiscountMeta({
    type: item.discount_type,
    value: item.discount_value,
  });
}

function pickLineSurchargeMeta(item) {
  if (!item || typeof item !== "object") return null;
  const fromObj = normalizeDiscountMeta(item.line_surcharge);
  if (fromObj) return fromObj;
  return normalizeDiscountMeta({
    type: item.surcharge_type,
    value: item.surcharge_value,
  });
}

function loadMenuVatMap(items) {
  const ids = [
    ...new Set(
      (items || [])
        .map((it) => (it?.menu_item_id != null ? Number(it.menu_item_id) : null))
        .filter((id) => id != null && Number.isFinite(id))
    ),
  ];
  const map = new Map();
  if (!ids.length) return map;
  try {
    const sqlite = getSqlite();
    const ph = ids.map(() => "?").join(",");
    const rows = sqlite
      .prepare(
        `SELECT id, COALESCE(vat_category, '18') AS vat_category
         FROM menu_items WHERE id IN (${ph})`
      )
      .all(...ids);
    for (const r of rows || []) {
      map.set(Number(r.id), r.vat_category);
    }
  } catch (e) {
    console.warn("[fiscal-main] loadMenuVatMap:", e.message);
  }
  return map;
}

function normalizeItems(items) {
  const list = items || [];
  const vatByMenuId = loadMenuVatMap(list);
  const { getVatRate } = require("./fiscal-vat");
  return list.map((item) => {
    const letter = resolveItemVatNorm(item, vatByMenuId);
    const fromLib = getVatRate(letter);
    const rate =
      fromLib != null
        ? Number(fromLib)
        : letter === "D"
          ? 8
          : letter === "E"
            ? 18
            : 0;
    const qty = normalizeQty(item.quantity ?? item.qty ?? 1);
    const unitPrice = normalizeUnitPrice(item);
    const lineDiscMeta = pickLineDiscountMeta(item);
    const lineSurMeta = pickLineSurchargeMeta(item);
    const normalized = {
      name: String(item.name || item.emri || "-").trim(),
      quantity: qty,
      qty,
      price: unitPrice,
      unit_price: unitPrice,
      base_price:
        item.base_price != null ? round4(item.base_price) : unitPrice,
      line_discount_amount: Number(item.line_discount_amount) || 0,
      line_surcharge_amount: Number(item.line_surcharge_amount) || 0,
      vat_norm: letter,
      vat_letter: letter,
      vat_category: String(rate),
      vat_rate: rate,
      vat_percent: rate,
      menu_item_id: item.menu_item_id ?? null,
    };
    if (lineDiscMeta) normalized.line_discount = lineDiscMeta;
    if (lineSurMeta) normalized.line_surcharge = lineSurMeta;
    return normalized;
  });
}

/** Tatimi (jo baza) — residual rounding në fiscal-vat. */
function taxFromBreakdown(items, turnoverBreak, opts = {}) {
  const result = calculateVatTaxBreakdown(items, opts);
  const tax = result
    ? result.tax
    : { A: 0, B: 0, C: 0, D: 0, E: 0 };
  return {
    tax,
    turnover: turnoverBreak || tax,
    totalTax: result ? result.totalTax : 0,
    totalWithoutTax: result ? result.totalWithoutTax : 0,
  };
}

/**
 * Printim fiskal me SAKTËSISHT të njëjtin pipeline ESC/POS si kuponi normal:
 * buildEscPosFromPlainText → ESC @ + CP1252 (ESC t 16) + markerë ^R/^B/^C → një cut.
 * Logo/QR bashkohen në të njëjtin job (pa font të ndryshëm, pa cut të shumëfishtë).
 */
/** Shmang printimin dyfish brenda 5 s (recovery + checkout). */
let lastFiscalPrintKey = "";
let lastFiscalPrintAt = 0;

async function printFiscalBundle(printText, qrResult, printOpts = {}) {
  const printer = require("../printer");
  const database = require("../database");
  const {
    buildEscPosFromPlainText,
    appendEscPosCut,
    bufferHasEscPosCut,
  } = require("../receipt-text");
  const { getFiscalLogoForPrint } = require("./fiscal-logo");
  const {
    validateReceiptBeforePrint,
  } = require("./fiscal-receipt-guard");

  let printed = false;
  let printMessage = "";
  let printMethod = "";
  const isRecovery = !!(printOpts && printOpts.recovery);
  try {
    if (!printText) {
      return { printed: false, printMessage: "Teksti i kuponit fiskal është bosh" };
    }

    if (!isRecovery && !printOpts.force) {
      const crypto = require("crypto");
      const key = crypto.createHash("md5").update(String(printText)).digest("hex");
      const now = Date.now();
      if (key === lastFiscalPrintKey && now - lastFiscalPrintAt < 5000) {
        console.warn("[fiscal-main] print skip duplicate (<5s)");
        return { printed: true, printMessage: "", printMethod: "dedup-skip" };
      }
      lastFiscalPrintKey = key;
      lastFiscalPrintAt = now;
    }

    let logo = null;
    try {
      logo = getFiscalLogoForPrint();
    } catch (e) {
      console.warn("[fiscal-main] Logo:", e.message);
    }
    const qrAttached = !!(
      qrResult &&
      (qrResult.escpos_base64 || qrResult.payload || qrResult.png_base64 || qrResult.png_buffer)
    );
    const logoAttached = !!(logo && logo.buffer && logo.buffer.length);

    const guard = validateReceiptBeforePrint(printText, {
      qrAttached: isRecovery ? true : qrAttached,
      logoAttached: isRecovery ? true : logoAttached,
    });
    if (!guard.ok) {
      return {
        printed: false,
        printMessage: guard.gabim || "Validimi i kuponit fiskal dështoi",
      };
    }

    const tysso = await printer.isTyssoReceiptPrinter(database);

    let textForPrint = printText;
    if (tysso && qrResult?.ascii && !qrAttached) {
      textForPrint = `${printText}\n${String(qrResult.ascii).trim()}\n`;
    }

    const textBuf = buildEscPosFromPlainText(textForPrint, tysso
      ? { cut: false, keepAlbanian: true, dark: false, fiscalEmphasized: false }
      : {
          cut: false,
          dark: true,
          fiscalEmphasized: true,
          allowDoubleSize: false,
          keepAlbanian: true,
        });
    const parts = [textBuf];

    if (qrAttached) {
      try {
        const { buildFiscalQrEscPosBuffer } = require("./fiscal-qr");
        const qrBuf = buildFiscalQrEscPosBuffer(qrResult, { moduleSize: tysso ? 3 : 4 });
        if (qrBuf && qrBuf.length) parts.push(qrBuf);
      } catch (e) {
        console.warn("[fiscal-main] QR print:", e.message);
      }
    }

    if (logoAttached) {
      parts.push(logo.buffer);
    }

    try {
      const { resolvePrintWidth, divider } = require("./fiscal-print");
      const w = resolvePrintWidth();
      parts.push(Buffer.from(`\n${divider("=", w)}\n`, "ascii"));
    } catch {
      parts.push(Buffer.from("\n==========================================\n", "ascii"));
    }

    let full = Buffer.concat(parts);
    if (!bufferHasEscPosCut(full)) {
      full = appendEscPosCut(full);
    }
    const send = await printer.printEscPosReceiptAt(full.toString("base64"), database, "bar");
    printed = true;
    printMethod = send?.method || send?.output || "";
  } catch (e) {
    printMessage = e.message || "Printimi fiskal dështoi";
  }
  return { printed, printMessage, printMethod };
}

function insertOnlineReceipt(row) {
  return insertFiscalReceipt({
    ...row,
    receipt_type: row.receipt_type || "regular",
    original_nuikf: row.original_nuikf || null,
    currency: row.currency || "EUR",
    is_offline: 0,
    sent_to_atk: 0,
  });
}

function assertValidNuikf(nuikf) {
  const s = String(nuikf || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{16}$/.test(s)) {
    throw new Error("NUIKF i pavlefshëm (duhet 16 alfanumerike): " + s);
  }
  if (/^\d{8}-\d{6}$/.test(String(nuikf))) {
    throw new Error("NUIKF nuk mund të jetë numri i faturës lokale");
  }
  return s;
}

/**
 * Proceson kuponin fiskal PAS closeTable.
 * @param {number} orderId — id e porosisë së mbyllur
 * @param {string} paymentMethod
 * @param {object} [opts] — operator_name, operator_id, items (override), skip_print
 */
async function processFiscalReceipt(orderId, paymentMethod, opts = {}) {
  if (!isFiscalEnabled()) {
    console.log("[fiscal-main] START processFiscalReceipt SKIP fiscal OFF orderId=", orderId);
    return null;
  }

  const sqlite = getSqlite();
  const id = Number(orderId);
  console.log("[fiscal-main] START processFiscalReceipt orderId=", id);
  try {
  if (!id) throw new Error("orderId mungon");

  const order = sqlite.prepare(`SELECT * FROM orders WHERE id = ?`).get(id);
  if (!order) throw new Error("Porosia nuk u gjet");

  // Idempotencë: mos krijo kupon të dytë për të njëjtën porosi (retry/double-submit)
  if (Number(order.is_fiscalized) === 1 && order.fiscal_receipt_id) {
    const existing = sqlite
      .prepare(`SELECT id, nuikf, sef_id, daily_number FROM fiscal_receipts WHERE id = ?`)
      .get(Number(order.fiscal_receipt_id));
    if (existing) {
      console.log(
        "[fiscal-main] processFiscalReceipt SKIP already fiscalized orderId=",
        id,
        "fiscal_receipt_id=",
        existing.id,
        "nuikf=",
        existing.nuikf
      );
      try {
        const recovery = require("./fiscal-recovery");
        const pending = recovery.getOpenPendingForOrder(id);
        if (
          pending &&
          (pending.stage === recovery.STAGES.COUPON_READY ||
            pending.stage === recovery.STAGES.PRINTING) &&
          pending.print_text
        ) {
          const resumed = await recovery.resumePendingPrint(pending, {
            skip_print: !!opts.skip_print,
          });
          tryBackfillDailyLogReceipt(id, {
            nuikf: existing.nuikf,
            fiscal_receipt_id: existing.id,
          });
          return {
            ok: true,
            already_fiscalized: true,
            recovered: true,
            fiscal_receipt_id: existing.id,
            nuikf: existing.nuikf,
            sef_id: existing.sef_id,
            daily_number: existing.daily_number,
            printed: resumed.printed,
            printMessage: resumed.printMessage || "Rikuperim printimi (MUNGESË RRYME)",
            recovery_text: resumed.recovery_text,
          };
        }
      } catch (re) {
        console.warn("[fiscal-main] recovery resume:", re.message);
      }
      tryBackfillDailyLogReceipt(id, {
        nuikf: existing.nuikf,
        fiscal_receipt_id: existing.id,
      });
      return {
        ok: true,
        already_fiscalized: true,
        fiscal_receipt_id: existing.id,
        nuikf: existing.nuikf,
        sef_id: existing.sef_id,
        daily_number: existing.daily_number,
        printed: false,
        printMessage: "Porosia është tashmë e fiskalizuar",
      };
    }
  }

  const settings = getFiscalSettings();
  // Gjuha e kuponit = fiscal_settings.language (duhet para generateFiscalReceipt)
  const receiptLang = syncLanguageFromSettings(
    settings && settings.language === "sr" ? "sr" : "sq"
  );
  console.log("[fiscal-main] processFiscalReceipt language=", receiptLang);
  const items = normalizeItems(
    opts.items || parseItems(order.items_json)
  );
  if (!items.length) {
    throw new Error("Porosia nuk ka artikuj për fiskalizim");
  }

  const payment = paymentMethod || order.payment_method || "cash";
  const paymentSplits =
    (Array.isArray(opts.payment_splits) && opts.payment_splits.length
      ? opts.payment_splits
      : null) || [];
  const operatorName =
    String(opts.operator_name || order.waiter_name || "Operator").trim() ||
    "Operator";
  const operatorId = String(opts.operator_id || "POS").trim() || "POS";

  const recovery = require("./fiscal-recovery");
  let pendingId = null;
  try {
    pendingId = recovery.beginPending({
      orderId: id,
      operatorName,
      operatorId,
    });
  } catch (e) {
    console.warn("[fiscal-main] beginPending:", e.message);
  }

  const dailyNumber = getNextDailyNumber();
  const totalNumber = getNextTotalNumber();
  // Gjithmonë NUIKF nga generateNUIKF() — JO receipt_number i faturës (YYYYMMDD-NNNNNN)
  const nuikf = assertValidNuikf(generateNUIKF());
  const sefId = getSefIdentifier() || "";
  if (dailyNumber == null || totalNumber == null || !nuikf) {
    throw new Error("Numërimi fiskal dështoi (daily/total/NUIKF)");
  }

  const subtotal =
    opts.subtotal != null
      ? Number(opts.subtotal)
      : Math.round(
          items.reduce(
            (s, it) =>
              s +
              (Number(it.quantity || it.qty) || 0) *
                (Number(it.unit_price || it.price) || 0),
            0
          ) * 100
        ) / 100;
  const discount = Number(opts.discount_amount ?? order.discount_total ?? 0) || 0;
  const totalAmount =
    opts.total_amount != null
      ? Number(opts.total_amount)
      : Number(order.total) || Math.round((subtotal - discount) * 100) / 100;
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new Error("total_amount duhet > 0 para INSERT fiskal");
  }

  const turnoverBreak = calculateVatBreakdown(items) || {
    A: 0,
    B: 0,
    C: 0,
    D: 0,
    E: 0,
  };
  const taxResult = taxFromBreakdown(items, turnoverBreak, {
    totalAmount,
  });
  const vatTax = taxResult.tax;
  const totalTax = Number(taxResult.totalTax) || 0;
  const totalWithoutTax =
    taxResult.totalWithoutTax != null
      ? Number(taxResult.totalWithoutTax)
      : Math.round((totalAmount - totalTax) * 100) / 100;

  const { fiscal_date, fiscal_time } = todayParts();
  const taxpayerNui =
    settings.taxpayer_nui || settings.developer_nui || "";
  const taxpayerVat = settings.taxpayer_vat_number || "";
  const taxpayerName = settings.taxpayer_legal_name || "Biznesi";
  const taxpayerAddress = settings.taxpayer_address || "";
  const unitName = settings.unit_name || "";
  const unitPhone = settings.unit_phone || "";

  const signPayload = {
    nuikf,
    total_amount: totalAmount,
    fiscal_date,
    fiscal_time,
    taxpayer_nui: taxpayerNui,
    sef_id: sefId,
    daily_number: dailyNumber,
    total_number: totalNumber,
    receipt_type: "regular",
  };

  let signature = null;
  try {
    signature = signReceipt(signPayload);
  } catch (e) {
    console.warn("[fiscal-main] signReceipt:", e.message);
  }

  let qrResult = null;
  try {
    qrResult = await generateFiscalQR({
      ...signPayload,
      total: totalAmount,
      nui: taxpayerNui,
    });
  } catch (e) {
    console.warn("[fiscal-main] generateFiscalQR:", e.message);
  }

  const orderData = {
    items,
    operator_name: operatorName,
    operator_id: operatorId,
    payment_method: payment,
    payment_splits: paymentSplits,
    subtotal,
    discount_amount: discount,
    total_amount: totalAmount,
    total_without_tax: totalWithoutTax,
    amount_paid: totalAmount,
  };

  const fiscalData = {
    taxpayer_legal_name: taxpayerName,
    taxpayer_address: taxpayerAddress,
    taxpayer_nui: taxpayerNui,
    taxpayer_vat: taxpayerVat,
    unit_name: unitName,
    unit_phone: unitPhone,
    daily_number: dailyNumber,
    total_number: totalNumber,
    nuikf,
    sef_id: sefId,
    receipt_type: "regular",
    is_offline: false,
    fiscal_date,
    fiscal_time,
    vat_breakdown: vatTax,
    language: receiptLang,
  };

  const online = await checkInternetConnection();
  let fiscalReceiptId = null;
  let isOffline = false;
  let printText = null;
  let atkSent = false;

  if (!online) {
    isOffline = true;
    fiscalData.is_offline = true;
    const queued = queueOfflineReceipt({
      sale_id: id,
      nuikf,
      sef_id: sefId,
      daily_number: dailyNumber,
      total_number: totalNumber,
      fiscal_date,
      fiscal_time,
      operator_name: operatorName,
      operator_id: operatorId,
      taxpayer_nui: taxpayerNui,
      taxpayer_vat: taxpayerVat,
      taxpayer_name: taxpayerName,
      taxpayer_address: taxpayerAddress,
      unit_name: unitName,
      unit_phone: unitPhone,
      items,
      subtotal,
      discount_amount: discount,
      total_amount: totalAmount,
      total_without_tax: totalWithoutTax,
      vat_breakdown: vatTax,
      payment_method: payment,
      payment_splits_json:
        paymentSplits.length > 0 ? JSON.stringify(paymentSplits) : null,
    });
    fiscalReceiptId = queued?.id || null;
    console.log(
      "[fiscal-main] INSERT OK receiptId=",
      fiscalReceiptId,
      "(offline queue) daily_number=",
      dailyNumber,
      "total_number=",
      totalNumber,
      "nuikf=",
      nuikf
    );
    printText = queued?.print_text || generateFiscalReceipt(orderData, fiscalData);
  } else {
    const qrPayload = JSON.stringify({
      placeholder: !qrResult,
      hapi: 8,
      verify_url: qrResult?.verify_url || null,
      signature: signature || qrResult?.signature || null,
    });

    const insertRow = {
      sale_id: id,
      nuikf,
      sef_id: sefId,
      daily_number: dailyNumber,
      total_number: totalNumber,
      fiscal_date,
      fiscal_time,
      operator_name: operatorName,
      operator_id: operatorId,
      taxpayer_nui: taxpayerNui,
      taxpayer_vat: taxpayerVat || null,
      taxpayer_name: taxpayerName,
      taxpayer_address: taxpayerAddress,
      items_json: JSON.stringify(items),
      subtotal,
      discount_amount: discount,
      total_amount: totalAmount,
      total_without_tax: totalWithoutTax,
      vat_breakdown_json: JSON.stringify(vatTax),
      payment_method: payment,
      payment_splits_json:
        paymentSplits.length > 0 ? JSON.stringify(paymentSplits) : null,
      qr_code_data: qrPayload,
      digital_signature: signature || null,
    };
    const preCheck = validateFiscalReceiptInsert(insertRow);
    if (!preCheck.ok) {
      throw new Error("Validimi para INSERT dështoi: " + preCheck.error);
    }
    fiscalReceiptId = insertOnlineReceipt(insertRow);
    console.log(
      "[fiscal-main] INSERT OK receiptId=",
      fiscalReceiptId,
      "daily_number=",
      dailyNumber,
      "nuikf=",
      nuikf,
      "total=",
      totalAmount
    );

    attachChainToFiscalData(fiscalData, getFiscalReceiptById(fiscalReceiptId));

    printText = generateFiscalReceipt(orderData, fiscalData);

    try {
      logFiscalAction(
        "receipt_created",
        {
          nuikf,
          order_id: id,
          total: totalAmount,
          offline: false,
          fiscal_receipt_id: fiscalReceiptId,
        },
        operatorName,
        operatorId
      );
    } catch (e) {
      console.warn("[fiscal-main] audit:", e.message);
    }

    // Neni 26/5 — ONLINE: prit përgjigjen ATK PARA printimit.
    // Në dështim: print me shënim + mbetet në radhë (sent_to_atk=0). Offline path i pandryshuar.
    let atkSentOk = false;
    let atkSendError = "";
    try {
      const { sendReceiptToAtk } = require("./fiscal-offline");
      const fullRow = sqlite
        .prepare(`SELECT * FROM fiscal_receipts WHERE id = ?`)
        .get(fiscalReceiptId);
      if (fullRow) {
        const sendResult = await sendReceiptToAtk(fullRow);
        if (sendResult?.sent) {
          atkSentOk = true;
          atkSent = true;
          const { fiscalReceiptUpdate } = require("./fiscal-db");
          fiscalReceiptUpdate(fiscalReceiptId, {
            sent_to_atk: 1,
            sent_at: new Date().toISOString().replace("T", " ").slice(0, 19),
            atk_response_json: sendResult,
          });
          logFiscalAction(
            "receipt_sent",
            {
              nuikf,
              fiscal_receipt_id: fiscalReceiptId,
              transaction_id: sendResult.transaction_id,
            },
            operatorName,
            operatorId
          );
        } else {
          atkSendError = String(sendResult?.error || sendResult?.status || "dështoi");
          logFiscalAction(
            "receipt_send_failed",
            {
              nuikf,
              fiscal_receipt_id: fiscalReceiptId,
              error: atkSendError,
              status: sendResult?.status,
              queued_for_retry: true,
            },
            operatorName,
            operatorId
          );
        }
      } else {
        atkSendError = "Rreshti i kuponit nuk u gjet pas INSERT";
      }
    } catch (e) {
      atkSendError = e.message || "ATK send exception";
      console.warn("[fiscal-main] ATK send:", atkSendError);
      try {
        logFiscalAction(
          "receipt_send_failed",
          {
            nuikf,
            fiscal_receipt_id: fiscalReceiptId,
            error: atkSendError,
            queued_for_retry: true,
          },
          operatorName,
          operatorId
        );
      } catch {
        /* */
      }
    }

    if (!atkSentOk) {
      const note =
        `\n^C^BATK DERGIMI DESHTOI\n` +
        `^CNe radhe per ritransmetim\n` +
        `^C${String(atkSendError || "gabim").slice(0, 40)}\n`;
      printText = String(printText || "") + note;
      console.warn(
        "[fiscal-main] ATK fail online — print me shënim, radhë ritransmetimi. nuikf=",
        nuikf,
        atkSendError
      );
    }
  }

  try {
    sqlite
      .prepare(
        `UPDATE orders SET fiscal_receipt_id = ?, is_fiscalized = 1 WHERE id = ?`
      )
      .run(fiscalReceiptId, id);
  } catch (e) {
    console.warn("[fiscal-main] update orders:", e.message);
  }

  tryBackfillDailyLogReceipt(id, {
    nuikf,
    fiscal_receipt_id: fiscalReceiptId,
  });

  try {
    if (pendingId && printText) {
      recovery.markCouponReady(pendingId, {
        fiscalReceiptId,
        nuikf,
        printText,
      });
    }
  } catch (e) {
    console.warn("[fiscal-main] markCouponReady:", e.message);
  }

  let printResult = { printed: false, printMessage: "" };
  if (!opts.skip_print) {
    try {
      if (pendingId) recovery.markPrinting(pendingId);
    } catch {
      /* */
    }
    printResult = await printFiscalBundle(printText, qrResult);
    if (printResult.printed && pendingId) {
      try {
        recovery.markDone(pendingId, { printed: true });
      } catch {
        /* */
      }
    }
  } else if (pendingId) {
    try {
      recovery.markDone(pendingId, { skip_print: true });
    } catch {
      /* */
    }
  }

  console.log(
    "[fiscal-main] DONE processFiscalReceipt orderId=",
    id,
    "receiptId=",
    fiscalReceiptId,
    "daily_number=",
    dailyNumber,
    "nuikf=",
    nuikf,
    "offline=",
    isOffline
  );

  return {
    ok: true,
    fiscal_receipt_id: fiscalReceiptId,
    nuikf,
    sef_id: sefId,
    daily_number: dailyNumber,
    is_offline: isOffline,
    print_mode: getFiscalPrintMode(),
    printed: printResult.printed,
    printMessage: printResult.printMessage,
    print_text: printText,
    pending_txn_id: pendingId,
    signature,
    atk_sent: atkSent,
    qr: qrResult
      ? {
          verify_url: qrResult.verify_url,
          escpos_base64: qrResult.escpos_base64,
        }
      : null,
  };
  } catch (err) {
    console.error("[fiscal-main] ERROR:", err.message || err, "orderId=", id);
    throw err;
  }
}

/**
 * Kupon fiskal provë (dummy) — printon në printer termik, pa INSERT në DB.
 * Vetëm kur fiscal ON.
 */
async function printTestFiscalCoupon() {
  if (!isFiscalEnabled()) {
    return { ok: false, gabim: "Fiskalizimi është OFF" };
  }

  const settings = getFiscalSettings() || {};
  const receiptLang = syncLanguageFromSettings(
    settings.language === "sr" ? "sr" : "sq"
  );
  console.log("[fiscal-main] printTestFiscalCoupon language=", receiptLang);
  const items = normalizeItems([
    { name: "Kafe Espresso", quantity: 1, price: 1.5, vat_norm: "E" },
    { name: "Uje 0.5L", quantity: 2, price: 1.0, vat_norm: "E" },
    { name: "Croissant", quantity: 1, price: 1.8, vat_norm: "E" },
  ]);
  const total = items.reduce(
    (s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0),
    0
  );
  const totalRounded = Math.round(total * 100) / 100;
  const vatBreak = calculateVatBreakdown(items) || { A: 0, B: 0, C: 0, D: 0, E: totalRounded };
  const taxResult = taxFromBreakdown(items, vatBreak, { totalAmount: totalRounded });
  const tax = taxResult.tax;
  const taxTotal = Number(taxResult.totalTax) || 0;
  const totalWithoutTax =
    taxResult.totalWithoutTax != null
      ? Number(taxResult.totalWithoutTax)
      : Math.round((totalRounded - taxTotal) * 100) / 100;
  const nuikf = assertValidNuikf(generateNUIKF());
  const { fiscal_date, fiscal_time } = todayParts();
  // Mos rrit numrin ditor — kupon prove pa INSERT
  let dailyNumber = 0;
  try {
    dailyNumber = Number(settings.daily_receipt_counter) || 0;
  } catch {
    dailyNumber = 0;
  }

  const fiscalData = {
    taxpayer_nui: settings.taxpayer_nui || "123456789",
    taxpayer_nf: settings.taxpayer_nf || "",
    taxpayer_vat_number: settings.taxpayer_vat_number || "",
    taxpayer_legal_name: settings.taxpayer_legal_name || "PROVE FISKALE",
    taxpayer_address: settings.taxpayer_address || "Adresa prove",
    business_unit_number: settings.business_unit_number || "1",
    unit_name: settings.unit_name || "Njësia Prove",
    unit_phone: settings.unit_phone || "044 000 000",
    pos_id: settings.pos_id || "1",
    nuikf,
    daily_number: dailyNumber || "PROVE",
    total_number: Number(settings.total_receipt_counter) || 1,
    sef_id: getSefIdentifier() || "",
    fiscal_date,
    fiscal_time,
    receipt_type: "regular",
    vat_breakdown: tax,
    is_offline: 0,
    language: receiptLang,
  };

  const orderData = {
    items,
    operator_name: "Prove",
    operator_id: "0",
    payment_method: "cash",
    subtotal: totalRounded,
    total_amount: totalRounded,
    total_without_tax: totalWithoutTax,
    amount_paid: totalRounded,
  };

  const printText = generateFiscalReceipt(orderData, fiscalData);
  if (!printText) {
    return { ok: false, gabim: "Nuk u gjenerua teksti i kuponit" };
  }

  let qrResult = null;
  try {
    qrResult = await generateFiscalQR({
      nuikf,
      total_amount: totalRounded,
      fiscal_date,
      taxpayer_nui: fiscalData.taxpayer_nui,
    });
  } catch (qe) {
    console.warn("[fiscal-main] QR kupon prove:", qe.message);
  }

  const printResult = await printFiscalBundle(printText, qrResult);
  if (!printResult.printed) {
    return {
      ok: false,
      gabim: printResult.printMessage || "Printeri nuk është i lidhur",
    };
  }

  return { ok: true, message: "U printua", nuikf, printed: true };
}

/**
 * Printim Raporti X / Z / Periodik — i njëjti fund si kuponi fiskal:
 * tekst ESC/POS → logo RKS/MF → vijë mbyllëse → cut (pa QR, pa guard kupon).
 */
async function printFiscalReportText(printText, printOpts = {}) {
  const printer = require("../printer");
  const database = require("../database");
  const {
    buildEscPosFromPlainText,
    appendEscPosCut,
    bufferHasEscPosCut,
  } = require("../receipt-text");
  const { getFiscalLogoForPrint } = require("./fiscal-logo");

  let printed = false;
  let printMessage = "";
  const station = printOpts.station || "bar";
  try {
    if (!printText) {
      return { printed: false, printMessage: "Teksti i raportit fiskal është bosh" };
    }

    let logo = null;
    try {
      logo = getFiscalLogoForPrint();
    } catch (e) {
      console.warn("[fiscal-main] Logo raport:", e.message);
    }
    const logoAttached = !!(logo && logo.buffer && logo.buffer.length);

    const textBuf = buildEscPosFromPlainText(printText, {
      cut: false,
      dark: true,
      fiscalEmphasized: true,
      allowDoubleSize: false,
      keepAlbanian: true,
    });
    const parts = [textBuf];

    if (logoAttached) {
      parts.push(logo.buffer);
    }

    try {
      const { resolvePrintWidth, divider } = require("./fiscal-print");
      const w = resolvePrintWidth();
      parts.push(Buffer.from(`\n${divider("=", w)}\n`, "ascii"));
    } catch {
      parts.push(Buffer.from("\n==========================================\n", "ascii"));
    }

    let full = Buffer.concat(parts);
    if (!bufferHasEscPosCut(full)) {
      full = appendEscPosCut(full);
    }
    const { printerName, paper } = await printer.ensureReceiptPrinter(database, station);
    await printer.printEscPosReceiptAt(full.toString("base64"), database, station);
    printed = true;
    return {
      printed: true,
      printMessage: "",
      printer: printerName,
      paper,
      output: "escpos-fiscal-report",
      station,
    };
  } catch (e) {
    printMessage = e.message || "Printimi i raportit fiskal dështoi";
  }
  return { printed, printMessage };
}

module.exports = {
  processFiscalReceipt,
  getFiscalPrintMode,
  setFiscalPrintMode,
  shouldPrintClosingNormalReceipt,
  shouldPrintNormalReceipt,
  printFiscalBundle,
  printFiscalReportText,
  printTestFiscalCoupon,
  PRINT_MODE_KEY,
};
