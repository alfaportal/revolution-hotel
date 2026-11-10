const express = require("express");
const service = require("./product-import-service");
const usbImport = require("./product-import-usb");

function wrapDb(db) {
  return {
    findProductByBarcode(barcode) {
      const row = db.findMenuItemByBarcode(barcode);
      if (!row || row.id == null) return null;
      return { id: row.id };
    },
    listPosCategories() {
      const cats = typeof db.getCategories === "function" ? db.getCategories() : [];
      return (cats || []).map((c) => ({ name: typeof c === "string" ? c : c.name }));
    },
    createPosCategory(name) {
      const n = String(name || "").trim();
      if (!n) return;
      const have = this.listPosCategories().some(
        (c) => String(c.name || "").trim().toLowerCase() === n.toLowerCase(),
      );
      if (have) return;
      db.addCategory(n);
    },
    createProduct({ name, price, barcode, pos_category }) {
      const id = db.addMenuItem({
        name,
        category: pos_category,
        price,
        barcode,
        stock_qty: 0,
        vat_category: "18",
      });
      return { id: Number(id) };
    },
    updateProduct(id, fields) {
      db.updateMenuItem(id, {
        name: fields.name,
        price: fields.price,
        barcode: fields.barcode,
        category: fields.pos_category,
      });
    },
    setProductStockAbsolute(id, stock) {
      db.updateMenuItem(id, { stock_qty: Math.max(0, Number(stock) || 0) });
    },
    insertProductImportRecord(row) {
      return db.insertProductImportRecord(row);
    },
    listBarcodeSet() {
      const rows = db.db.prepare(
        "SELECT lower(trim(barcode)) AS b FROM menu_items WHERE trim(COALESCE(barcode, '')) != ''",
      ).all();
      const set = new Set();
      for (const r of rows) {
        if (r.b) set.add(r.b);
      }
      return set;
    },
    insertProductsBatch(items) {
      const names = new Set();
      for (const it of items) names.add(String(it.category || "Të tjera").trim() || "Të tjera");
      for (const name of names) this.createPosCategory(name);
      const maxRows = db.db.prepare(
        "SELECT category, COALESCE(MAX(sort_order), -1) AS m FROM menu_items GROUP BY category",
      ).all();
      const sort = new Map();
      for (const r of maxRows) sort.set(r.category, Number(r.m));
      const ins = db.db.prepare(
        `INSERT INTO menu_items (
          name, category, price, active, vat_category, sort_order, barcode, stock_qty
        ) VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
      );
      const params = [];
      for (const it of items) {
        const cat = String(it.category || "Të tjera").trim() || "Të tjera";
        const next = (sort.has(cat) ? sort.get(cat) : -1) + 1;
        sort.set(cat, next);
        params.push([
          String(it.name || "").trim(),
          cat,
          it.price,
          String(it.vat || "18"),
          next,
          String(it.barcode || "").trim(),
          Math.max(0, Number(it.stock) || 0),
        ]);
      }
      ins.runMany(params);
    },
  };
}

async function registerImportBuffer(realDb, buffer, filename) {
  const db = wrapDb(realDb);
  const prepared = await service.prepareProductImport(buffer, filename);
  const run = () => service.registerParsedProducts(db, prepared.parsed, prepared.filename || filename);
  if (realDb.db && typeof realDb.db.transaction === "function") {
    return realDb.db.transaction(run)();
  }
  return run();
}

function readMultipartUpload(req) {
  return new Promise((resolve, reject) => {
    const ct = String(req.headers["content-type"] || "");
    if (!ct.includes("multipart/form-data")) {
      reject(new Error("USE_JSON"));
      return;
    }
    const bMatch = /boundary=(?:\"([^\"]+)\"|([^;\s]+))/i.exec(ct);
    const boundary = bMatch ? (bMatch[1] || bMatch[2] || "").trim() : "";
    if (!boundary) {
      reject(new Error("Boundary mungon"));
      return;
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(service.extractMultipartFile(Buffer.concat(chunks), boundary));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function registerProductImportRoutes(app, realDb, { guard } = {}) {
  const db = wrapDb(realDb);
  const jsonBig = express.json({ limit: "50mb" });
  const mid = Array.isArray(guard) ? guard : guard ? [guard] : [];

  app.get("/api/products/import/sample", ...mid, (req, res) => {
    const csv = service.buildSampleCsv();
    const accept = String(req.headers.accept || "");
    const wantFile = String(req.query?.download || "") === "1" || accept.includes("text/csv");
    if (!wantFile && accept.includes("text/html")) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(`<!DOCTYPE html><html lang="sq"><head><meta charset="utf-8"><title>Shembulli</title></head><body style="margin:0;background:#0f172a;color:#e2e8f0;font-family:sans-serif"><div style="padding:28px"><button type="button" id="back" style="font-size:18px;padding:12px 18px;border:0;border-radius:8px;background:#f97316;color:#fff;cursor:pointer">← Kthehu</button><p style="margin-top:16px">Shembulli u shkarkua.</p></div><script>document.getElementById("back").onclick=function(){if(history.length>1){history.back();}else{location.href="/admin.html";}};<\/script></body></html>`);
      return;
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="import-produkte-shembull.csv"');
    res.send("\uFEFF" + csv);
  });

  app.get("/api/products/import/drives", ...mid, (_req, res) => {
    try {
      const { drives, log } = usbImport.listImportDrives();
      res.json({
        ok: true,
        drives: drives.map((d) => ({
          letter: d.letter,
          name: d.name,
          size: d.size,
          path: d.path,
        })),
        scan_log: log || [],
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get("/api/products/import/browse", ...mid, (req, res) => {
    try {
      const folderPath = String(req.query?.path || "").trim();
      if (!folderPath) {
        res.status(400).json({ ok: false, error: "Rruga mungon" });
        return;
      }
      const out = usbImport.browseImportFolder(folderPath);
      res.json({ ok: true, ...out });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  async function previewFromPathHandler(req, res) {
    try {
      const filePath = String(req.body?.path || req.body?.file_path || "").trim();
      if (!filePath) {
        res.status(400).json({ ok: false, error: "Skedari mungon" });
        return;
      }
      const { buffer, filename } = usbImport.readUsbImportFileBuffer(filePath);
      const out = await service.buildUploadPreview(db, buffer, filename);
      res.json({ ok: true, ...out });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  }

  app.post("/api/products/import/upload-from-path", ...mid, jsonBig, previewFromPathHandler);
  app.post("/api/products/import/from-path", ...mid, jsonBig, previewFromPathHandler);

  app.post("/api/products/import/register-from-path", ...mid, jsonBig, async (req, res) => {
    try {
      const filePath = String(req.body?.path || req.body?.file_path || "").trim();
      if (!filePath) {
        res.status(400).json({ ok: false, error: "Skedari mungon" });
        return;
      }
      const { buffer, filename } = usbImport.readUsbImportFileBuffer(filePath);
      const result = await registerImportBuffer(realDb, buffer, filename);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/products/import/register", ...mid, (req, res) => {
    const send = async (name, buffer) => {
      const result = await registerImportBuffer(realDb, buffer, name);
      res.json({ ok: true, ...result });
    };
    const ct = String(req.headers["content-type"] || "");
    if (ct.includes("multipart/form-data")) {
      readMultipartUpload(req)
        .then(({ filename, buffer }) => send(filename, buffer))
        .catch((e) => res.status(400).json({ ok: false, error: e.message }));
      return;
    }
    jsonBig(req, res, () => {
      (async () => {
        try {
          const filename = String(req.body?.filename || "upload.csv");
          const b64 = req.body?.data || req.body?.contentBase64 || "";
          if (!b64) {
            res.status(400).json({ ok: false, error: "Skedari mungon" });
            return;
          }
          await send(filename, Buffer.from(b64, "base64"));
        } catch (e) {
          res.status(400).json({ ok: false, error: e.message });
        }
      })();
    });
  });

  app.get("/api/products/import/usb-scan", ...mid, (_req, res) => {
    try {
      const { drives, files, log } = usbImport.scanUsbImportFiles();
      const list = files.map(({ drive, filename, path: filePath, size, modified, modified_local }) => ({
        drive,
        filename,
        path: filePath,
        size,
        modified,
        modified_local,
      }));
      res.json({
        ok: true,
        drives,
        files: list,
        scan_log: log || [],
        empty: list.length === 0,
        message: list.length === 0 ? "Nuk u gjet asnjë skedar CSV/Excel në USB" : "",
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get("/api/products/import/history", ...mid, (_req, res) => {
    try {
      const history = realDb.listProductImportHistory();
      res.json({ ok: true, history });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/products/import/upload", ...mid, (req, res) => {
    const ct = String(req.headers["content-type"] || "");
    const sendPreview = async (filename, buffer) => {
      const out = await service.buildUploadPreview(db, buffer, filename);
      res.json({ ok: true, ...out });
    };
    if (ct.includes("multipart/form-data")) {
      readMultipartUpload(req)
        .then(({ filename, buffer }) => sendPreview(filename, buffer))
        .catch((e) => res.status(400).json({ ok: false, error: e.message }));
      return;
    }
    jsonBig(req, res, () => {
      (async () => {
        try {
          const filename = String(req.body?.filename || "upload.csv");
          const b64 = req.body?.data || req.body?.contentBase64 || "";
          if (!b64) {
            res.status(400).json({ ok: false, error: "Skedari mungon" });
            return;
          }
          await sendPreview(filename, Buffer.from(b64, "base64"));
        } catch (e) {
          res.status(400).json({ ok: false, error: e.message });
        }
      })();
    });
  });

  app.post("/api/products/import/confirm", ...mid, jsonBig, (req, res) => {
    try {
      const result = service.confirmProductImport(db, req.body || {});
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });
}

module.exports = { registerProductImportRoutes, registerImportBuffer };
