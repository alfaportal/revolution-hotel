const path = require("path");
const ExcelJS = require("exceljs");

const SAMPLE_ROWS = [
  ["8600000000001", "Shembull Ujë 0.5L", "0.50", "Ushqimore", "120"],
  ["8600000000002", "Shembull Biskota", "1.20", "Ushqimore", "80"],
  ["8600000000003", "Shembull Detergjent", "3.99", "Higjienë", "25"],
  ["8600000000004", "Shembull Kabllo USB", "4.50", "Elektronikë", "15"],
  ["8600000000005", "Shembull Çaj", "2.10", "Ushqimore", "200"],
];

const HEADER_ALIASES = {
  barcode: ["barcode", "barkodi", "barkod", "bar code"],
  name: ["name", "emri", "emër", "emer", "product", "produkti"],
  price: ["price", "cmimi", "çmimi", "cmim", "çmim"],
  category: ["category", "kategoria", "kategori", "pos_category"],
  stock: ["stock", "sasia", "stok", "stoku", "qty", "quantity"],
};

function buildSampleCsv() {
  const lines = ["barcode,name,price,category,stock"];
  for (const r of SAMPLE_ROWS) {
    lines.push(r.map((c) => (String(c).includes(",") ? `"${c}"` : c)).join(","));
  }
  return lines.join("\r\n");
}

function normalizeHeaderCell(v) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
}

function mapHeaderIndexes(headerRow) {
  const idx = { barcode: -1, name: -1, price: -1, category: -1, stock: -1 };
  headerRow.forEach((cell, i) => {
    const h = normalizeHeaderCell(cell);
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(h) || h === key) idx[key] = i;
    }
  });
  if (idx.barcode < 0 && idx.name < 0 && headerRow.length >= 2) {
    idx.barcode = 0;
    idx.name = 1;
    idx.price = headerRow.length > 2 ? 2 : -1;
    idx.category = headerRow.length > 3 ? 3 : -1;
    idx.stock = headerRow.length > 4 ? 4 : -1;
  }
  return idx;
}

function parseCsvText(text) {
  const raw = String(text || "").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) return [];
  const rows = [];
  for (const line of lines) {
    const cells = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else if (ch === '"') inQ = false;
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === "," || ch === ";") {
        cells.push(cur);
        cur = "";
      } else cur += ch;
    }
    cells.push(cur);
    rows.push(cells.map((c) => String(c).trim()));
  }
  return rows;
}

function rowsFromCsvBuffer(buffer) {
  const text = buffer.toString("utf8");
  return parseCsvText(text);
}

async function rowsFromXlsxBuffer(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets[0];
  if (!sheet) return [];
  const out = [];
  sheet.eachRow((row) => {
    const cells = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      while (cells.length < col - 1) cells.push("");
      let v = cell.value;
      if (v && typeof v === "object" && v.text != null) v = v.text;
      if (v == null) v = "";
      cells.push(String(v).trim());
    });
    if (cells.some((c) => c !== "")) out.push(cells);
  });
  return out;
}

function parseFileBuffer(buffer, filename) {
  const ext = path.extname(String(filename || "")).toLowerCase();
  if (ext === ".csv" || ext === ".txt" || ext === "") {
    return Promise.resolve(rowsFromCsvBuffer(buffer));
  }
  if (ext === ".xlsx") {
    return rowsFromXlsxBuffer(buffer);
  }
  if (ext === ".xls") {
    return Promise.reject(new Error("Formati .xls nuk mbështetet — ruajeni si .xlsx ose .csv"));
  }
  return Promise.reject(new Error("Format i pavlefshëm — përdorni .csv, .xlsx ose .xls"));
}

function toDataRows(matrix) {
  if (!matrix || matrix.length < 2) return [];
  const header = matrix[0];
  const idx = mapHeaderIndexes(header);
  const data = [];
  for (let r = 1; r < matrix.length; r += 1) {
    const row = matrix[r];
    if (!row || !row.some((c) => String(c || "").trim() !== "")) continue;
    const pick = (i) => (i >= 0 && i < row.length ? String(row[i] ?? "").trim() : "");
    data.push({
      barcode: pick(idx.barcode).replace(/\s+/g, ""),
      name: pick(idx.name),
      priceRaw: pick(idx.price),
      category: pick(idx.category) || "Të tjera",
      stockRaw: pick(idx.stock),
    });
  }
  return data;
}

function validateRow(row) {
  const barcode = String(row.barcode || "").trim();
  const name = String(row.name || "").trim();
  const priceNum = Number(String(row.priceRaw || "").replace(",", "."));
  const stockNum =
    row.stockRaw === "" || row.stockRaw == null
      ? 0
      : Number(String(row.stockRaw).replace(",", "."));
  if (!barcode) {
    return { ok: false, status: "error", error_message: "Mungon barkodi" };
  }
  if (!name) {
    return { ok: false, status: "error", error_message: "Mungon emri" };
  }
  if (!Number.isFinite(priceNum)) {
    return { ok: false, status: "error", error_message: "Çmimi nuk është numër" };
  }
  if (priceNum < 0) {
    return { ok: false, status: "error", error_message: "Çmimi negative" };
  }
  if (row.stockRaw !== "" && row.stockRaw != null && !Number.isFinite(stockNum)) {
    return { ok: false, status: "error", error_message: "Sasia nuk është numër" };
  }
  return {
    ok: true,
    barcode,
    name,
    price: Math.round(priceNum * 100) / 100,
    category: String(row.category || "Të tjera").trim() || "Të tjera",
    stock: Number.isFinite(stockNum) && stockNum >= 0 ? stockNum : 0,
  };
}

function previewFromParsedRows(db, parsedRows) {
  const rows = [];
  let newCount = 0;
  let existsCount = 0;
  let errors = 0;
  for (const raw of parsedRows) {
    const v = validateRow(raw);
    if (!v.ok) {
      errors += 1;
      rows.push({
        barcode: raw.barcode || "",
        name: raw.name || "",
        price: raw.priceRaw || "",
        category: raw.category || "",
        stock: raw.stockRaw || "",
        status: "error",
        error_message: v.error_message,
      });
      continue;
    }
    const existing = db.findProductByBarcode(v.barcode);
    if (existing) {
      existsCount += 1;
      rows.push({
        barcode: v.barcode,
        name: v.name,
        price: v.price,
        category: v.category,
        stock: v.stock,
        status: "exists",
        existing_id: existing.id,
        error_message: "",
      });
    } else {
      newCount += 1;
      rows.push({
        barcode: v.barcode,
        name: v.name,
        price: v.price,
        category: v.category,
        stock: v.stock,
        status: "new",
        error_message: "",
      });
    }
  }
  return {
    rows,
    summary: { new: newCount, exists: existsCount, errors },
  };
}

async function buildUploadPreview(db, buffer, filename) {
  const matrix = await parseFileBuffer(buffer, filename);
  if (!matrix.length) throw new Error("Skedari është bosh");
  const parsed = toDataRows(matrix);
  if (!parsed.length) throw new Error("Nuk u gjetën rreshta të dhënash");
  const preview = previewFromParsedRows(db, parsed);
  return { filename: String(filename || ""), ...preview };
}

function ensurePosCategoryName(db, name) {
  const n = String(name || "").trim() || "Të tjera";
  const cats = db.listPosCategories({ all: true });
  if (cats.some((c) => String(c.name).trim().toLowerCase() === n.toLowerCase())) return n;
  try {
    db.createPosCategory(n);
  } catch {
    void 0;
  }
  return n;
}

function confirmProductImport(db, body) {
  const rowsIn = Array.isArray(body?.rows) ? body.rows : [];
  const filename = String(body?.filename || "import.csv");
  let newCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const totalRows = rowsIn.length;

  for (const item of rowsIn) {
    const action = String(item?.action || "").toLowerCase();
    if (action === "skip") {
      skippedCount += 1;
      continue;
    }
    const v = validateRow({
      barcode: item?.barcode,
      name: item?.name,
      priceRaw: item?.price,
      category: item?.category,
      stockRaw: item?.stock,
    });
    if (!v.ok) {
      errorCount += 1;
      continue;
    }
    if (action === "insert") {
      try {
        const posCat = ensurePosCategoryName(db, v.category);
        const product = db.createProduct({
          name: v.name,
          price: v.price,
          barcode: v.barcode,
          pos_category: posCat,
        });
        if (v.stock > 0) db.setProductStockAbsolute(product.id, v.stock);
        newCount += 1;
      } catch {
        errorCount += 1;
      }
      continue;
    }
    if (action === "update") {
      try {
        const existing = db.findProductByBarcode(v.barcode);
        if (!existing) {
          errorCount += 1;
          continue;
        }
        const posCat = ensurePosCategoryName(db, v.category);
        db.updateProduct(existing.id, {
          name: v.name,
          price: v.price,
          barcode: v.barcode,
          pos_category: posCat,
          vat_letter: existing.vat_letter || "E",
          unit_code: existing.unit_code || "EA",
          category_code: existing.category_code || "TT",
        });
        db.setProductStockAbsolute(existing.id, v.stock);
        updatedCount += 1;
      } catch {
        errorCount += 1;
      }
      continue;
    }
    skippedCount += 1;
  }

  db.insertProductImportRecord({
    filename,
    total_rows: totalRows,
    new_count: newCount,
    updated_count: updatedCount,
    skipped_count: skippedCount,
    error_count: errorCount,
  });

  return {
    new_count: newCount,
    updated_count: updatedCount,
    skipped_count: skippedCount,
    error_count: errorCount,
    total_rows: totalRows,
  };
}

function extractMultipartFile(bodyBuffer, boundary) {
  const b = `--${boundary}`;
  const parts = bodyBuffer.toString("binary").split(b).slice(1, -1);
  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const headers = part.slice(0, headerEnd);
    if (!/filename=/i.test(headers)) continue;
    const fnMatch = /filename=\"([^\"]+)\"|filename=([^\r\n;]+)/i.exec(headers);
    const filename = fnMatch ? (fnMatch[1] || fnMatch[2] || "").trim() : "upload.csv";
    let content = part.slice(headerEnd + 4);
    if (content.endsWith("\r\n")) content = content.slice(0, -2);
    const buffer = Buffer.from(content, "binary");
    return { filename, buffer };
  }
  throw new Error("Skedari nuk u gjet në formular");
}

module.exports = {
  buildSampleCsv,
  buildUploadPreview,
  confirmProductImport,
  extractMultipartFile,
  previewFromParsedRows,
  parseCsvText,
};
