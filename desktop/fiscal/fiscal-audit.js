/**
 * fiscal/fiscal-audit.js — HAPI 10: audit log WRITE-ONCE + eksport CSV/PDF.
 * Vetëm INSERT në fiscal_audit_log. Kur isFiscalEnabled()=false → null.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { isFiscalEnabled } = require("./fiscal-config");

const ALLOWED_ACTIONS = Object.freeze([
  "receipt_created",
  "receipt_sent",
  "receipt_send_failed",
  "z_report",
  "x_report",
  "periodic_report",
  "power_recovery",
  "setting_changed",
  "correction_created",
  "offline_start",
  "offline_end",
  "login",
  "error",
  "self_test",
  "write_once_violation",
  "backup_created",
  "paper_block_mode_on",
  "paper_block_mode_off",
  "paper_block_issued",
  "paper_block_registered",
]);

const SYSTEM_ACTIONS = Object.freeze(new Set(["backup_created"]));

/** Veprimet që shfaqen në eksport/UI audit (ATK Neni 26). */
const FISCAL_AUDIT_EXPORT_ACTIONS = Object.freeze([
  "receipt_created",
  "receipt_sent",
  "correction_created",
  "z_report",
  "x_report",
  "offline_start",
  "offline_end",
  "backup_created",
  "power_recovery",
]);

const AUDIT_PURGE_FLAG = "audit_legacy_noise_purged_v2";

function getSqlite() {
  const database = require("../database");
  if (!database || !database.db) {
    throw new Error("Databaza nuk është e gatshme");
  }
  return database.db;
}

function getDocumentsDir() {
  const home = os.homedir();
  const docs = path.join(home, "Documents");
  if (fs.existsSync(docs)) return docs;
  const alt = path.join(home, "Dokumentet");
  if (fs.existsSync(alt)) return alt;
  fs.mkdirSync(docs, { recursive: true });
  return docs;
}

function normalizeDateBound(value, endOfDay) {
  if (!value) return null;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return endOfDay ? `${s} 23:59:59` : `${s} 00:00:00`;
  }
  return s;
}

/**
 * INSERT write-once në fiscal_audit_log.
 */
function logFiscalAction(action, details, operatorName, operatorId) {
  const act = String(action || "")
    .trim()
    .toLowerCase();
  if (!ALLOWED_ACTIONS.includes(act)) {
    throw new Error(
      `Veprim i panjohur audit: ${action}. Lejohen: ${ALLOWED_ACTIONS.join(", ")}`
    );
  }
  // Login audit: gjithmonë (edhe kur SEF UI është OFF) — gati për certifikim.
  if (act !== "login" && !SYSTEM_ACTIONS.has(act) && !isFiscalEnabled()) return null;

  const sqlite = getSqlite();
  const detailsJson = JSON.stringify(
    details && typeof details === "object" ? details : { value: details }
  );
  const result = sqlite
    .prepare(
      `INSERT INTO fiscal_audit_log (action, details_json, operator_name, operator_id)
       VALUES (?, ?, ?, ?)`
    )
    .run(
      act,
      detailsJson,
      operatorName != null ? String(operatorName) : null,
      operatorId != null ? String(operatorId) : null
    );

  return {
    id: result.lastInsertRowid,
    action: act,
    details,
    operator_name: operatorName || null,
    operator_id: operatorId || null,
  };
}

function isFiscalExportAction(action) {
  return FISCAL_AUDIT_EXPORT_ACTIONS.includes(String(action || "").toLowerCase());
}

function filterFiscalExportRows(rows) {
  return (rows || []).filter((r) => isFiscalExportAction(r.action));
}

function reinstallAuditWriteOnceTriggers(sqlite) {
  sqlite.exec(`DROP TRIGGER IF EXISTS trg_fiscal_audit_block_update`);
  sqlite.exec(`
    CREATE TRIGGER trg_fiscal_audit_block_update
    BEFORE UPDATE ON fiscal_audit_log
    FOR EACH ROW
    BEGIN
      SELECT RAISE(ABORT, 'WRITE-ONCE: UPDATE i ndaluar në fiscal_audit_log');
    END;
  `);
  sqlite.exec(`DROP TRIGGER IF EXISTS trg_fiscal_audit_block_delete`);
  sqlite.exec(`
    CREATE TRIGGER trg_fiscal_audit_block_delete
    BEFORE DELETE ON fiscal_audit_log
    FOR EACH ROW
    BEGIN
      SELECT RAISE(ABORT, 'WRITE-ONCE: DELETE i ndaluar në fiscal_audit_log');
    END;
  `);
}

/**
 * Fshin një herë rreshtat test/debug — mbaj vetëm veprime fiskale reale.
 */
function purgeLegacyAuditNoise() {
  const database = require("../database");
  if (database.getSetting(AUDIT_PURGE_FLAG) === "1") {
    return { skipped: true, deleted: 0 };
  }

  const sqlite = getSqlite();
  const placeholders = FISCAL_AUDIT_EXPORT_ACTIONS.map(() => "?").join(", ");
  sqlite.exec(`DROP TRIGGER IF EXISTS trg_fiscal_audit_block_delete`);
  const result = sqlite
    .prepare(
      `DELETE FROM fiscal_audit_log
       WHERE action NOT IN (${placeholders})
          OR action = 'setting_changed'
          OR operator_name = 'TEST'
          OR operator_id IN ('TEST', 'SELFTEST')
          OR details_json LIKE '%"self_test"%'
          OR created_at LIKE '2026-07-16%'`
    )
    .run(...FISCAL_AUDIT_EXPORT_ACTIONS);
  reinstallAuditWriteOnceTriggers(sqlite);
  database.setSetting(AUDIT_PURGE_FLAG, "1");
  return { skipped: false, deleted: Number(result.changes) || 0 };
}

/**
 * Lista e veprimeve brenda datave (YYYY-MM-DD ose datetime).
 */
function getAuditLog(fromDate, toDate) {
  if (!isFiscalEnabled()) return null;

  const sqlite = getSqlite();
  const from = normalizeDateBound(fromDate, false);
  const to = normalizeDateBound(toDate, true);

  let sql = `SELECT id, action, details_json, operator_name, operator_id, created_at
             FROM fiscal_audit_log WHERE 1=1`;
  const params = [];
  if (from) {
    sql += ` AND created_at >= ?`;
    params.push(from);
  }
  if (to) {
    sql += ` AND created_at <= ?`;
    params.push(to);
  }
  sql += ` ORDER BY id ASC`;

  const rows = sqlite.prepare(sql).all(...params);
  const mapped = rows.map((r) => {
    let details = {};
    try {
      details = JSON.parse(r.details_json || "{}");
    } catch {
      details = { raw: r.details_json };
    }
    return {
      id: r.id,
      action: r.action,
      details,
      details_json: r.details_json,
      operator_name: r.operator_name,
      operator_id: r.operator_id,
      created_at: r.created_at,
    };
  });
  return filterFiscalExportRows(mapped);
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function defaultAuditExportName(format) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const ext = String(format || "csv").toLowerCase() === "pdf" ? "pdf" : "csv";
  return `fiscal-audit-${stamp}.${ext}`;
}

/**
 * Dialog Electron Save As — operatori zgjedh folderin dhe emrin e skedarit.
 * Kthen null nëse anulohet ose jashtë Electron.
 */
function pickAuditSaveDialog(format, parentWindow) {
  try {
    const { dialog, BrowserWindow } = require("electron");
    const win =
      parentWindow ||
      BrowserWindow.getFocusedWindow() ||
      BrowserWindow.getAllWindows()[0] ||
      null;
    const fmt = String(format || "csv").toLowerCase();
    const isPdf = fmt === "pdf";
    const defaultName = defaultAuditExportName(fmt);
    const result = dialog.showSaveDialogSync(win, {
      title: "Eksport audit log — ruaj si",
      defaultPath: path.join(getDocumentsDir(), defaultName),
      filters: isPdf
        ? [{ name: "PDF", extensions: ["pdf"] }]
        : [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!result) return null;
    return result;
  } catch {
    return null;
  }
}

/**
 * Eksport CSV. Pa targetPath → null. Kthen shtegun ose null.
 */
function exportAuditCSV(fromDate, toDate, targetPath) {
  if (!isFiscalEnabled()) return null;

  const rows = getAuditLog(fromDate, toDate) || [];
  const header = [
    "id",
    "created_at",
    "action",
    "operator_name",
    "operator_id",
    "details_json",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.created_at,
        r.action,
        r.operator_name,
        r.operator_id,
        r.details_json || JSON.stringify(r.details || {}),
      ]
        .map(csvEscape)
        .join(",")
    );
  }

  const filePath = targetPath ? String(targetPath).trim() : "";
  if (!filePath) return null;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "\uFEFF" + lines.join("\r\n") + "\r\n", "utf8");
  return filePath;
}

const PDF_PAGE_WIDTH = 595;
const PDF_PAGE_HEIGHT = 842;
const PDF_MARGIN = 36;
const PDF_FONT_SIZE = 8;
const PDF_LINE_HEIGHT = 11;
const PDF_CHARS_PER_LINE = 105;

const PDF_COL = Object.freeze({
  id: 5,
  date: 19,
  action: 20,
  operator: 14,
  gap: 2,
});

function padEndText(value, width) {
  const s = String(value ?? "");
  if (s.length >= width) return s.slice(0, width);
  return s + " ".repeat(width - s.length);
}

function padStartText(value, width) {
  const s = String(value ?? "");
  if (s.length >= width) return s.slice(0, width);
  return " ".repeat(width - s.length) + s;
}

function pdfDetailColumnWidth() {
  return (
    PDF_CHARS_PER_LINE -
    PDF_COL.id -
    PDF_COL.date -
    PDF_COL.action -
    PDF_COL.operator -
    4 * PDF_COL.gap
  );
}

function pdfDetailIndent() {
  return " ".repeat(
    PDF_COL.id +
      PDF_COL.gap +
      PDF_COL.date +
      PDF_COL.gap +
      PDF_COL.action +
      PDF_COL.gap +
      PDF_COL.operator +
      PDF_COL.gap
  );
}

function wrapText(text, maxWidth) {
  const normalized = String(text || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [""];

  const words = normalized.split(" ");
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (word.length > maxWidth) {
      for (let i = 0; i < word.length; i += maxWidth) {
        lines.push(word.slice(i, i + maxWidth));
      }
      current = "";
    } else {
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function formatAuditMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

function formatAuditPayment(method) {
  const key = String(method || "cash").trim().toLowerCase();
  if (key === "card") return "Kartelë";
  if (key === "transfer") return "Transfer";
  if (key === "mixed") return "E përzier";
  if (key === "cash") return "Para të gatshme";
  return method ? String(method) : "—";
}

function formatCorrectionTypeLabel(type) {
  const key = String(type || "").trim().toLowerCase();
  if (key === "cancel") return "Anulim";
  if (key === "return") return "Kthim";
  if (key === "storno") return "Storno";
  return type ? String(type) : "—";
}

function formatAuditActionLabel(action) {
  const key = String(action || "").trim().toLowerCase();
  const labels = {
    receipt_created: "Kupon i krijuar",
    receipt_sent: "Dërguar te ATK",
    correction_created: "Korrigjim",
    z_report: "Raporti Z",
    x_report: "Raporti X",
    offline_start: "Offline filloi",
    offline_end: "Offline mbaroi",
    backup_created: "Backup",
    power_recovery: "Rikuperim energjie",
  };
  return labels[key] || key || "—";
}

function formatAuditDetailFallback(details) {
  const d = details && typeof details === "object" ? details : {};
  const parts = [];
  for (const [key, value] of Object.entries(d)) {
    if (value == null || value === "") continue;
    if (typeof value === "object") continue;
    parts.push(`${key}: ${value}`);
  }
  return parts.length ? parts.join(", ") : "—";
}

function formatAuditDetailText(row) {
  const d = row && row.details && typeof row.details === "object" ? row.details : {};
  const action = String(row?.action || "").toLowerCase();

  if (action === "receipt_created") {
    const parts = [
      d.nuikf ? `NUIKF: ${d.nuikf}` : null,
      d.total != null ? `Totali: ${formatAuditMoney(d.total)} EUR` : null,
      d.payment_method ? `Pagesa: ${formatAuditPayment(d.payment_method)}` : null,
      d.daily_number != null ? `Nr. ditor: ${d.daily_number}` : null,
      d.offline ? "Offline: Po" : null,
      d.local_only ? "Lokal: Po" : null,
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : formatAuditDetailFallback(d);
  }

  if (action === "correction_created") {
    const parts = [
      d.nuikf ? `NUIKF: ${d.nuikf}` : null,
      d.receipt_type ? `Lloji: ${formatCorrectionTypeLabel(d.receipt_type)}` : null,
      d.original_nuikf ? `Origjinal: ${d.original_nuikf}` : null,
      d.total != null ? `Totali: ${formatAuditMoney(d.total)} EUR` : null,
      d.reason ? `Arsyeja: ${d.reason}` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : formatAuditDetailFallback(d);
  }

  if (action === "x_report" || action === "z_report") {
    const parts = [
      d.date ? `Data: ${d.date}` : null,
      d.coupon_count != null
        ? `Kupona: ${d.coupon_count}`
        : d.rfd_count != null
          ? `Kupona: ${d.rfd_count}`
          : null,
      d.total_amount != null ? `Totali: ${formatAuditMoney(d.total_amount)} EUR` : null,
      action === "z_report" && d.reset_applied ? "Reset ditor: Po" : null,
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : formatAuditDetailFallback(d);
  }

  if (action === "receipt_sent") {
    const parts = [
      d.nuikf ? `NUIKF: ${d.nuikf}` : null,
      d.transaction_id ? `TX: ${d.transaction_id}` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : formatAuditDetailFallback(d);
  }

  if (action === "offline_start" || action === "offline_end") {
    return d.at ? `Koha: ${String(d.at).replace("T", " ").slice(0, 19)}` : formatAuditDetailFallback(d);
  }

  if (action === "backup_created") {
    const dest = d.dest_dir ? path.basename(String(d.dest_dir)) : null;
    const parts = [
      dest ? `Destinacioni: ${dest}` : d.dest_dir ? `Destinacioni: ${d.dest_dir}` : null,
      d.file_count != null ? `Skedarë: ${d.file_count}` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : formatAuditDetailFallback(d);
  }

  if (action === "power_recovery") {
    const parts = [
      d.nuikf ? `NUIKF: ${d.nuikf}` : null,
      d.order_id != null ? `Porosia: ${d.order_id}` : null,
      d.printed != null ? `Printuar: ${d.printed ? "Po" : "Jo"}` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : formatAuditDetailFallback(d);
  }

  return formatAuditDetailFallback(d);
}

function formatAuditTableRow(id, createdAt, actionLabel, operatorName, detailLine) {
  const g = PDF_COL.gap;
  return (
    padStartText(id, PDF_COL.id) +
    " ".repeat(g) +
    padEndText(String(createdAt || "").slice(0, 19), PDF_COL.date) +
    " ".repeat(g) +
    padEndText(actionLabel, PDF_COL.action) +
    " ".repeat(g) +
    padEndText(operatorName || "-", PDF_COL.operator) +
    " ".repeat(g) +
    detailLine
  );
}

function buildAuditPdfLines(rows, fromDate, toDate) {
  const detailWidth = pdfDetailColumnWidth();
  const indent = pdfDetailIndent();
  const rule = "-".repeat(Math.min(PDF_CHARS_PER_LINE, 105));
  const lines = [
    `Audit Log Fiskal — ${fromDate || "..."} deri ${toDate || "..."}`,
    "=".repeat(Math.min(PDF_CHARS_PER_LINE, 105)),
    formatAuditTableRow("#", "Data/Ora", "Veprimi", "Operatori", "Detaje"),
    rule,
  ];

  for (const r of rows) {
    const actionLabel = formatAuditActionLabel(r.action);
    const detailLines = wrapText(formatAuditDetailText(r), detailWidth);
    lines.push(
      formatAuditTableRow(r.id, r.created_at, actionLabel, r.operator_name, detailLines[0] || "—")
    );
    for (let i = 1; i < detailLines.length; i++) {
      lines.push(indent + detailLines[i]);
    }
  }

  lines.push(rule);
  lines.push(`Totali: ${rows.length} regjistrime`);
  return lines;
}

/** PDF minimal (tekst) pa dependency të jashtëm — A4, shumë faqe, word wrap. */
function buildSimplePdf(lines) {
  const pageWidth = PDF_PAGE_WIDTH;
  const pageHeight = PDF_PAGE_HEIGHT;
  const margin = PDF_MARGIN;
  const fontSize = PDF_FONT_SIZE;
  const lineHeight = PDF_LINE_HEIGHT;
  const usableHeight = pageHeight - margin * 2;
  const linesPerPage = Math.floor(usableHeight / lineHeight);

  const pages = [];
  for (let i = 0; i < lines.length; i += linesPerPage) {
    pages.push(lines.slice(i, i + linesPerPage));
  }
  if (!pages.length) pages.push(["(nuk ka regjistrime)"]);

  const objects = [];
  const addObj = (content) => {
    objects.push(content);
    return objects.length;
  };

  addObj("<< /Type /Catalog /Pages 2 0 R >>");
  addObj("PAGES_PLACEHOLDER");

  const fontId = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");
  const pageIds = [];

  for (const pageLines of pages) {
    const escaped = pageLines.map((ln) =>
      String(ln)
        .replace(/\\/g, "\\\\")
        .replace(/\(/g, "\\(")
        .replace(/\)/g, "\\)")
    );
    let y = pageHeight - margin - fontSize;
    const streamParts = [`BT /F1 ${fontSize} Tf 0 Tg`];
    for (const ln of escaped) {
      streamParts.push(`1 0 0 1 ${margin} ${y} Tm (${ln}) Tj`);
      y -= lineHeight;
    }
    streamParts.push("ET");
    const stream = streamParts.join("\n");
    const contentId = addObj(
      `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`
    );
    const pageId = addObj(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
        `/Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`
    );
    pageIds.push(pageId);
  }

  objects[1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefPos = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
}

/**
 * Eksport PDF. Pa targetPath → null. Kthen shtegun ose null.
 */
function exportAuditPDF(fromDate, toDate, targetPath) {
  if (!isFiscalEnabled()) return null;

  const rows = getAuditLog(fromDate, toDate) || [];
  const lines = buildAuditPdfLines(rows, fromDate, toDate);

  const filePath = targetPath ? String(targetPath).trim() : "";
  if (!filePath) return null;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buildSimplePdf(lines));
  return filePath;
}

module.exports = {
  ALLOWED_ACTIONS,
  FISCAL_AUDIT_EXPORT_ACTIONS,
  logFiscalAction,
  getAuditLog,
  exportAuditCSV,
  exportAuditPDF,
  pickAuditSaveDialog,
  purgeLegacyAuditNoise,
  getDocumentsDir,
};
