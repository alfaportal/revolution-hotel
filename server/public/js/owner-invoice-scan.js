/** Owner panel — skanim faturash furnizuesi me AI → stok automatik */
(function () {
  let invoiceScanItems = [];
  let invoiceScanPreviewUrl = null;
  let invoiceScanFile = null;
  let ingredientsForMatch = [];

  function escAttr(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /** Kompreso foton që të kalojë limiti i serverit (ishte "request entity too large"). */
  async function compressImageToDataUrl(file, { maxEdge = 1600, maxBytes = 850_000 } = {}) {
    if (!file) return null;
    const drawToCanvas = async () => {
      let bitmap = null;
      try {
        bitmap = await createImageBitmap(file);
      } catch {
        const url = URL.createObjectURL(file);
        try {
          const img = await new Promise((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error("Nuk u lexua fotoja."));
            el.src = url;
          });
          return { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height, source: img };
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      const out = { width: bitmap.width, height: bitmap.height, source: bitmap };
      return out;
    };

    const { width, height, source } = await drawToCanvas();
    let w = width || 1200;
    let h = height || 1200;
    const scale = Math.min(1, maxEdge / Math.max(w, h, 1));
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(source, 0, 0, w, h);
    if (typeof source.close === "function") source.close();

    let quality = 0.78;
    let blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    while (blob && blob.size > maxBytes && quality > 0.4) {
      quality -= 0.08;
      blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    }
    if (!blob) throw new Error("Kompresimi i fotos dështoi.");
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Nuk u lexua skedari."));
      reader.readAsDataURL(blob);
    });
  }

  function setInvoiceScanStatus(text, ok) {
    const el = document.getElementById("invoice-scan-status");
    if (!el) return;
    if (!text) {
      el.textContent = "";
      el.className = "owner-license-msg";
      return;
    }
    el.textContent = text;
    el.className = `owner-license-msg ${ok ? "ok" : "err"}`;
  }

  function normalizeName(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function suggestIngredientId(name) {
    const target = normalizeName(name);
    if (!target || !ingredientsForMatch.length) return "";
    const exact = ingredientsForMatch.find((i) => normalizeName(i.name) === target);
    if (exact) return exact.id;
    const tokens = target.split(" ").filter((t) => t.length >= 3);
    const partial = ingredientsForMatch.find((i) => {
      const n = normalizeName(i.name);
      if (n.includes(target) || target.includes(n)) return true;
      return tokens.some((t) => n.includes(t));
    });
    return partial?.id || "";
  }

  function ingredientOptionsHtml(selectedId) {
    const opts = ['<option value="">— Krijo i ri —</option>'];
    for (const ing of ingredientsForMatch) {
      const sel = ing.id === selectedId ? " selected" : "";
      opts.push(
        `<option value="${escAttr(ing.id)}"${sel}>${escAttr(ing.name)} (${escAttr(ing.unit)})</option>`,
      );
    }
    return opts.join("");
  }

  function renderInvoiceScanItems() {
    const body = document.getElementById("invoice-scan-items-body");
    const results = document.getElementById("invoice-scan-results");
    if (!body || !results) return;
    if (!invoiceScanItems.length) {
      body.innerHTML = "";
      results.classList.add("hidden");
      return;
    }
    body.innerHTML = invoiceScanItems
      .map((item, idx) => {
        const matchId = item.ingredient_id || suggestIngredientId(item.name);
        const unitNorm = item.unit === "pako" ? "pako" : (item.unit === "kg" ? "kg" : (item.unit === "l" ? "l" : "copë"));
        const ppp = unitNorm === "pako"
          ? (Number(item.pieces_per_pack) > 0 ? Number(item.pieces_per_pack) : 24)
          : 1;
        return `<tr>
          <td><input type="text" class="invoice-scan-name" data-idx="${idx}" value="${escAttr(item.name)}"></td>
          <td><input type="number" class="invoice-scan-qty" data-idx="${idx}" min="0" step="0.001" value="${Number(item.quantity || 0)}" title="Sasia nga fatura"></td>
          <td>
            <select class="invoice-scan-unit" data-idx="${idx}">
              <option value="copë"${unitNorm === "copë" ? " selected" : ""}>copë</option>
              <option value="pako"${unitNorm === "pako" ? " selected" : ""}>pako</option>
              <option value="kg"${unitNorm === "kg" ? " selected" : ""}>kg</option>
              <option value="l"${unitNorm === "l" ? " selected" : ""}>l</option>
            </select>
          </td>
          <td><input type="number" class="invoice-scan-ppp" data-idx="${idx}" min="1" step="1" value="${ppp}" title="Vetëm për pako — sa copë ka 1 pako"></td>
          <td><input type="number" class="invoice-scan-price" data-idx="${idx}" min="0" step="0.01" value="${Number(item.unit_price || 0).toFixed(2)}" title="Çmimi për 1 njësi (copë ose pako)"></td>
          <td><select class="invoice-scan-match" data-idx="${idx}">${ingredientOptionsHtml(matchId)}</select></td>
        </tr>`;
      })
      .join("");
    results.classList.remove("hidden");
  }

  function readInvoiceScanItemsFromDom() {
    return invoiceScanItems
      .map((item, idx) => {
        const name = document.querySelector(`.invoice-scan-name[data-idx="${idx}"]`)?.value?.trim();
        const quantity = Number(document.querySelector(`.invoice-scan-qty[data-idx="${idx}"]`)?.value);
        const unit = document.querySelector(`.invoice-scan-unit[data-idx="${idx}"]`)?.value || "copë";
        const pieces_per_pack = Number(document.querySelector(`.invoice-scan-ppp[data-idx="${idx}"]`)?.value);
        const unit_price = Number(document.querySelector(`.invoice-scan-price[data-idx="${idx}"]`)?.value);
        const ingredient_id = document.querySelector(`.invoice-scan-match[data-idx="${idx}"]`)?.value || "";
        return {
          name: name || item.name,
          quantity: Number.isFinite(quantity) ? quantity : item.quantity,
          unit,
          pieces_per_pack: unit === "pako"
            ? (Number.isFinite(pieces_per_pack) && pieces_per_pack > 0 ? pieces_per_pack : 24)
            : 1,
          unit_price: Number.isFinite(unit_price) ? unit_price : item.unit_price,
          ingredient_id: ingredient_id || null,
          create_if_missing: !ingredient_id,
        };
      })
      .filter((item) => item.name && Number.isFinite(item.quantity) && item.quantity > 0);
  }

  async function loadIngredientsForMatch() {
    try {
      const data = await api("/api/owner/ingredients");
      ingredientsForMatch = data.ingredients || [];
    } catch {
      ingredientsForMatch = [];
    }
  }

  async function openInvoiceScanModal() {
    invoiceScanItems = [];
    invoiceScanFile = null;
    setInvoiceScanStatus("", true);
    document.getElementById("invoice-scan-results")?.classList.add("hidden");
    document.getElementById("invoice-scan-loading")?.classList.add("hidden");
    ["invoice-scan-file", "invoice-scan-file-camera", "invoice-scan-file-gallery"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    document.getElementById("invoice-scan-supplier").value = "";
    document.getElementById("invoice-scan-number").value = "";
    const nuiEl = document.getElementById("invoice-scan-nui");
    if (nuiEl) nuiEl.value = "";
    const vatIdEl = document.getElementById("invoice-scan-vat-id");
    if (vatIdEl) vatIdEl.value = "";
    const vatRateEl = document.getElementById("invoice-scan-vat-rate");
    if (vatRateEl) vatRateEl.value = "18";
    document.getElementById("btn-invoice-scan-run").disabled = true;
    if (invoiceScanPreviewUrl) {
      URL.revokeObjectURL(invoiceScanPreviewUrl);
      invoiceScanPreviewUrl = null;
    }
    document.getElementById("invoice-scan-preview-wrap")?.classList.add("hidden");
    await loadIngredientsForMatch();
    document.getElementById("invoice-scan-modal")?.classList.remove("hidden");
  }

  function closeInvoiceScanModal() {
    document.getElementById("invoice-scan-modal")?.classList.add("hidden");
  }

  window.openInvoiceScanModal = () => {
    openInvoiceScanModal().catch((err) => setInvoiceScanStatus(err.message, false));
  };

  function onInvoiceFileChosen(file) {
    const previewWrap = document.getElementById("invoice-scan-preview-wrap");
    const preview = document.getElementById("invoice-scan-preview");
    const runBtn = document.getElementById("btn-invoice-scan-run");
    if (!file) {
      invoiceScanFile = null;
      if (runBtn) runBtn.disabled = true;
      previewWrap?.classList.add("hidden");
      return;
    }
    invoiceScanFile = file;
    const hidden = document.getElementById("invoice-scan-file");
    if (hidden) {
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        hidden.files = dt.files;
      } catch {
        /* ignore */
      }
    }
    if (invoiceScanPreviewUrl) URL.revokeObjectURL(invoiceScanPreviewUrl);
    invoiceScanPreviewUrl = URL.createObjectURL(file);
    if (preview) preview.src = invoiceScanPreviewUrl;
    previewWrap?.classList.remove("hidden");
    if (runBtn) runBtn.disabled = false;
    invoiceScanItems = [];
    document.getElementById("invoice-scan-results")?.classList.add("hidden");
    setInvoiceScanStatus("Foto e gatshme — shtyp Skano.", true);
  }

  async function runInvoiceScan() {
    const file =
      invoiceScanFile ||
      document.getElementById("invoice-scan-file")?.files?.[0] ||
      document.getElementById("invoice-scan-file-gallery")?.files?.[0] ||
      document.getElementById("invoice-scan-file-camera")?.files?.[0];
    if (!file) {
      setInvoiceScanStatus("Zgjidhni një foto nga kamera ose galeria.", false);
      return;
    }
    if (!navigator.onLine) {
      setInvoiceScanStatus("Nuk ka internet. Lidhu dhe provo sërish — skanimi AI kërkon rrjet.", false);
      return;
    }
    const runBtn = document.getElementById("btn-invoice-scan-run");
    const loading = document.getElementById("invoice-scan-loading");
    if (runBtn) runBtn.disabled = true;
    loading?.classList.remove("hidden");
    setInvoiceScanStatus("Duke kompresuar foton…", true);
    document.getElementById("invoice-scan-results")?.classList.add("hidden");
    try {
      const photo = await compressImageToDataUrl(file);
      setInvoiceScanStatus("Duke lexuar faturën me AI…", true);
      const data = await api("/api/ai/scan-invoice", {
        method: "POST",
        body: JSON.stringify({ photo }),
      });
      invoiceScanItems = Array.isArray(data.items) ? data.items : [];
      document.getElementById("invoice-scan-supplier").value = data.supplier || "";
      document.getElementById("invoice-scan-number").value = data.invoice_number || "";
      const nuiEl = document.getElementById("invoice-scan-nui");
      if (nuiEl) nuiEl.value = data.supplier_nui || "";
      const vatIdEl = document.getElementById("invoice-scan-vat-id");
      if (vatIdEl) vatIdEl.value = data.supplier_vat || "";
      const vatRateEl = document.getElementById("invoice-scan-vat-rate");
      if (vatRateEl) {
        const r = Number(data.vat_rate);
        vatRateEl.value = r === 0 || r === 8 || r === 18 ? String(r) : "18";
      }
      window.__invoiceScanDate = data.invoice_date || "";
      renderInvoiceScanItems();
      const warnList = Array.isArray(data.warnings) ? data.warnings.filter(Boolean) : [];
      const warnText = warnList.length ? ` ⚠ ${warnList[0]}` : "";
      setInvoiceScanStatus(
        `${invoiceScanItems.length} artikuj (blerje stoku). Kontrollo dhe Regjistro në Stok.${warnText}`,
        warnList.length ? false : true,
      );
    } catch (err) {
      const msg = String(err.message || err || "");
      if (/entity too large|413|payload/i.test(msg)) {
        setInvoiceScanStatus(
          "Fotoja është ende shumë e madhe. Provo nga Galeria një foto më të vogël, ose rifoto më afër faturës.",
          false,
        );
      } else {
        setInvoiceScanStatus(msg, false);
      }
    } finally {
      loading?.classList.add("hidden");
      if (runBtn) runBtn.disabled = false;
    }
  }

  async function applyInvoiceScan() {
    const items = readInvoiceScanItemsFromDom();
    const supplier = document.getElementById("invoice-scan-supplier")?.value?.trim() || "";
    const supplier_nui = document.getElementById("invoice-scan-nui")?.value?.trim() || "";
    const supplier_vat = document.getElementById("invoice-scan-vat-id")?.value?.trim() || "";
    const vat_rate = Number(document.getElementById("invoice-scan-vat-rate")?.value ?? 18);
    const invoice_number = document.getElementById("invoice-scan-number")?.value?.trim() || "";
    if (!items.length) {
      setInvoiceScanStatus("Nuk ka artikuj për import.", false);
      return;
    }
    const applyBtn = document.getElementById("btn-invoice-scan-apply");
    if (applyBtn) applyBtn.disabled = true;
    setInvoiceScanStatus("Duke përditësuar stokun…", true);
    const payload = {
      supplier,
      supplier_nui,
      supplier_vat,
      vat_rate,
      purchase_kind: "goods",
      invoice_number,
      invoice_date: window.__invoiceScanDate || "",
      items,
    };
    try {
      if (!navigator.onLine) {
        const key = "ri_pos_pending_invoice_scans";
        const q = JSON.parse(localStorage.getItem(key) || "[]");
        q.push({ ...payload, saved_at: new Date().toISOString() });
        localStorage.setItem(key, JSON.stringify(q));
        setInvoiceScanStatus(
          "Pa internet — fatura u ruajt lokalisht. Do të sinkronizohet kur të vijë rrjeti.",
          true,
        );
        return;
      }
      const data = await api("/api/owner/inventory/apply-invoice-scan", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      closeInvoiceScanModal();
      if (typeof window.loadOwnerInventory === "function") {
        await window.loadOwnerInventory();
      }
      if (typeof window.loadOwnerStock === "function") {
        await window.loadOwnerStock();
      }
      const msg =
        document.getElementById("blerje-msg") || document.getElementById("inventory-msg");
      if (msg) {
        const posNote = data.pos_pending
          ? " U dërgua te POS — Stoku / Blerjet në desktop do të përditësohen automatikisht."
          : "";
        msg.textContent =
          `${data.applied_count} artikuj u importuan (${data.created_count} të rinj, ${data.updated_count} u përditësuan).` +
          posNote;
        msg.className = "owner-license-msg ok";
      }
    } catch (err) {
      if (!navigator.onLine || /failed to fetch|network|offline/i.test(String(err.message || ""))) {
        try {
          const key = "ri_pos_pending_invoice_scans";
          const q = JSON.parse(localStorage.getItem(key) || "[]");
          q.push({ ...payload, saved_at: new Date().toISOString() });
          localStorage.setItem(key, JSON.stringify(q));
          setInvoiceScanStatus("Gabim rrjeti — u ruajt për sinkronizim më vonë.", true);
          return;
        } catch {
          /* fall through */
        }
      }
      setInvoiceScanStatus(err.message, false);
    } finally {
      if (applyBtn) applyBtn.disabled = false;
    }
  }

  async function flushPendingInvoiceScans() {
    if (!navigator.onLine) return;
    const key = "ri_pos_pending_invoice_scans";
    let q = [];
    try {
      q = JSON.parse(localStorage.getItem(key) || "[]");
    } catch {
      q = [];
    }
    if (!Array.isArray(q) || !q.length) return;
    const remain = [];
    for (const row of q) {
      try {
        await api("/api/owner/inventory/apply-invoice-scan", {
          method: "POST",
          body: JSON.stringify({
            supplier: row.supplier || "",
            invoice_number: row.invoice_number || "",
            items: row.items || [],
          }),
        });
      } catch {
        remain.push(row);
      }
    }
    localStorage.setItem(key, JSON.stringify(remain));
    if (remain.length < q.length && typeof window.loadOwnerInventory === "function") {
      window.loadOwnerInventory().catch(() => {});
    }
  }

  function applyInvoiceScanAiButton(data) {
    const card = document.getElementById("blerje-scan-card");
    const btns = [
      document.getElementById("btn-invoice-scan-ai"),
      document.getElementById("btn-blerje-scan-open"),
      document.getElementById("btn-ai-hub-scan-invoice"),
    ].filter(Boolean);
    if (!data) return;
    const msg = window.AI_UPGRADE_MSG || "Kontaktoni Revolution POS për upgrade";
    const active = !!data.enabled;
    const needsUpgrade = !!data.configured && !data.paused && !data.package_ai;
    if (card) {
      if (active || needsUpgrade) {
        card.removeAttribute("hidden");
        card.classList.remove("hidden");
      } else {
        card.setAttribute("hidden", "");
      }
    }
    if (!btns.length) return;
    for (const btn of btns) {
      if (active) {
        btn.removeAttribute("hidden");
        btn.disabled = false;
        btn.classList.remove("ai-feature-locked");
        if (btn.id !== "btn-ai-hub-scan-invoice") {
          btn.title = "Skano faturën e furnizuesit (opsionale)";
        }
      } else if (needsUpgrade) {
        btn.removeAttribute("hidden");
        btn.disabled = true;
        btn.classList.add("ai-feature-locked");
        btn.title = msg;
      } else {
        btn.setAttribute("hidden", "");
        btn.disabled = false;
        btn.classList.remove("ai-feature-locked");
        btn.title = "";
      }
    }
  }

  window.applyInvoiceScanAiButton = applyInvoiceScanAiButton;

  function openBlerjeAndScan() {
    const tab = document.querySelector('.tab[data-tab="blerje"]');
    if (tab) tab.click();
    openInvoiceScanModal().catch((err) => setInvoiceScanStatus(err.message, false));
  }

  document.getElementById("btn-invoice-scan-ai")?.addEventListener("click", () => {
    openInvoiceScanModal().catch((err) => setInvoiceScanStatus(err.message, false));
  });
  document.getElementById("btn-blerje-scan-open")?.addEventListener("click", () => {
    openInvoiceScanModal().catch((err) => setInvoiceScanStatus(err.message, false));
  });
  document.getElementById("invoice-scan-close")?.addEventListener("click", closeInvoiceScanModal);
  document.getElementById("invoice-scan-backdrop")?.addEventListener("click", closeInvoiceScanModal);
  document.getElementById("btn-invoice-scan-run")?.addEventListener("click", () => {
    runInvoiceScan().catch((err) => setInvoiceScanStatus(err.message, false));
  });
  document.getElementById("btn-invoice-scan-apply")?.addEventListener("click", () => {
    applyInvoiceScan().catch((err) => setInvoiceScanStatus(err.message, false));
  });

  window.openBlerjeAndScan = openBlerjeAndScan;
  function bindFileInput(id) {
    document.getElementById(id)?.addEventListener("change", (e) => {
      onInvoiceFileChosen(e.target.files?.[0] || null);
    });
  }
  bindFileInput("invoice-scan-file");
  bindFileInput("invoice-scan-file-camera");
  bindFileInput("invoice-scan-file-gallery");

  window.addEventListener("online", () => {
    flushPendingInvoiceScans().catch(() => {});
  });
  setTimeout(() => flushPendingInvoiceScans().catch(() => {}), 2500);
})();
