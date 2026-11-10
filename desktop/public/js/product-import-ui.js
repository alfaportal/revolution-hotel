(function () {
  let rows = [];
  let uploadFilename = "";
  let globalExistsAction = "update";
  let importing = false;
  let browserFolderPath = null;

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function statusLabel(st) {
    if (st === "new") return '<span class="pi-status pi-new">🟢 I ri</span>';
    if (st === "exists") return '<span class="pi-status pi-exists">🟠 Ekziston</span>';
    return '<span class="pi-status pi-error">🔴 Gabim</span>';
  }

  function countSummary() {
    let n = 0;
    let e = 0;
    let err = 0;
    for (const r of rows) {
      if (r._removed) continue;
      if (r.status === "new") n += 1;
      else if (r.status === "exists") e += 1;
      else if (r.status === "error") err += 1;
    }
    return { new: n, exists: e, errors: err };
  }

  function validImportCount() {
    let c = 0;
    for (const r of rows) {
      if (r._removed || r.status === "error") continue;
      const act = r.status === "exists" ? r.existsAction || globalExistsAction : "insert";
      if (act === "skip") continue;
      c += 1;
    }
    return c;
  }

  function renderSummary() {
    const el = document.getElementById("pi-summary");
    if (!el) return;
    const s = countSummary();
    el.textContent = `${s.new} të reja, ${s.exists} ekzistojnë, ${s.errors} gabime`;
  }

  function renderTable() {
    const tbody = document.getElementById("pi-preview-body");
    if (!tbody) return;
    const visible = rows.filter((r) => !r._removed);
    tbody.innerHTML = visible
      .map((r, i) => {
        const idx = rows.indexOf(r);
        let statusCell = statusLabel(r.status);
        if (r.status === "exists") {
          const sel = r.existsAction || globalExistsAction;
          statusCell += `<div class="pi-exists-row"><select class="pi-exists-action" data-idx="${idx}">
            <option value="update"${sel === "update" ? " selected" : ""}>Përditëso</option>
            <option value="skip"${sel === "skip" ? " selected" : ""}>Anashkalo</option>
          </select></div>`;
        } else if (r.status === "error") {
          statusCell += `<div class="pi-muted">${esc(r.error_message || "Gabim")}</div>`;
        }
        return `<tr data-idx="${idx}">
          <td>${i + 1}</td>
          <td>${esc(r.barcode)}</td>
          <td>${esc(r.name)}</td>
          <td style="text-align:right">${esc(r.price)}</td>
          <td>${esc(r.category)}</td>
          <td style="text-align:right">${esc(r.stock)}</td>
          <td>${statusCell}</td>
          <td><button type="button" class="btn btn-ghost btn-sm pi-remove" data-idx="${idx}">Fshij</button></td>
        </tr>`;
      })
      .join("");
    renderSummary();
    const btn = document.getElementById("pi-confirm-btn");
    if (btn) btn.disabled = validImportCount() === 0 || importing;
    document.getElementById("pi-step-preview")?.classList.toggle("hidden", visible.length === 0);
  }

  async function apiJson(path, opts) {
    if (typeof window.api === "function") return window.api(path, opts);
    const r = await fetch(path, opts);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }

  function formatBytes(n) {
    const b = Number(n) || 0;
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  }

  function applyPreviewData(data) {
    uploadFilename = String(data.filename || "import.csv");
    rows = (data.rows || []).map((r) => ({
      ...r,
      existsAction: r.status === "exists" ? globalExistsAction : undefined,
    }));
    document.getElementById("pi-step-upload")?.classList.remove("hidden");
    document.getElementById("pi-result")?.classList.add("hidden");
    renderTable();
  }

  async function uploadFile(file) {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/products/import/upload", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }

  async function onFileSelected(f) {
    const msg = document.getElementById("pi-msg");
    if (!f) return;
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    if (!["csv", "xlsx", "xls", "txt"].includes(ext)) {
      if (msg) msg.textContent = "Format i pavlefshëm.";
      return;
    }
    try {
      if (msg) msg.textContent = "Duke lexuar skedarin…";
      const data = await uploadFile(f);
      if (msg) msg.textContent = "";
      applyPreviewData(data);
    } catch (e) {
      if (msg) msg.textContent = e.message || String(e);
    }
  }

  function setBrowserNav(mode, displayPath, parentPath) {
    const upBtn = document.getElementById("pi-browser-up");
    const drivesBtn = document.getElementById("pi-browser-drives");
    const pathEl = document.getElementById("pi-browser-path");
    if (pathEl) {
      pathEl.textContent =
        mode === "drives" ? "Zgjidhni diskun (D: – Z:)" : displayPath || "";
    }
    if (upBtn) upBtn.hidden = mode !== "folder" || !parentPath;
    if (drivesBtn) drivesBtn.hidden = mode !== "folder";
    if (upBtn) upBtn.dataset.parent = parentPath || "";
  }

  function openUsbBrowser() {
    const overlay = document.getElementById("pi-browser-overlay");
    if (!overlay) return;
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
    browserFolderPath = null;
    showDriveList();
  }

  function closeUsbBrowser() {
    const overlay = document.getElementById("pi-browser-overlay");
    if (!overlay) return;
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
    browserFolderPath = null;
  }

  function setBrowserMessage(text, show) {
    const el = document.getElementById("pi-browser-msg");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("hidden", !show);
  }

  function setBrowserHeadColumns(mode) {
    const thead = document.getElementById("pi-browser-thead");
    if (!thead) return;
    if (mode === "drives") {
      thead.innerHTML = `<tr><th>Drive</th><th>Emri</th><th style="text-align:right">Madhësia</th></tr>`;
      return;
    }
    thead.innerHTML = `<tr><th>Emri</th><th style="text-align:right">Madhësia</th><th>Ndryshuar</th></tr>`;
  }

  async function showDriveList() {
    browserFolderPath = null;
    setBrowserHeadColumns("drives");
    setBrowserNav("drives", "", null);
    setBrowserMessage("", false);
    const body = document.getElementById("pi-browser-body");
    if (body) body.innerHTML = `<tr><td colspan="3">Duke ngarkuar…</td></tr>`;
    try {
      const data = await apiJson("/api/products/import/drives");
      const drives = data.drives || [];
      if (!drives.length) {
        if (body) {
          body.innerHTML = `<tr><td colspan="3">Nuk u gjet asnjë disk i jashtëm (D:–Z:)</td></tr>`;
        }
        setBrowserMessage("Nuk u gjet asnjë skedar CSV/Excel në USB", true);
        return;
      }
      if (body) {
        body.innerHTML = drives
          .map(
            (d) => `<tr class="pi-browser-drive-row" data-path="${esc(d.path)}" tabindex="0">
              <td>${esc(d.letter)}</td>
              <td>${esc(d.name || d.letter)}</td>
              <td style="text-align:right">${esc(formatBytes(d.size))}</td>
            </tr>`
          )
          .join("");
      }
    } catch (e) {
      if (body) body.innerHTML = `<tr><td colspan="3">${esc(e.message || "Gabim")}</td></tr>`;
    }
  }

  async function showFolder(folderPath) {
    browserFolderPath = folderPath;
    setBrowserHeadColumns("folder");
    setBrowserMessage("", false);
    const body = document.getElementById("pi-browser-body");
    if (body) body.innerHTML = `<tr><td colspan="3">Duke lexuar folderin…</td></tr>`;
    try {
      const q = encodeURIComponent(folderPath);
      const data = await apiJson(`/api/products/import/browse?path=${q}`);
      setBrowserNav("folder", data.display_path || folderPath, data.parent || "");
      const items = data.items || [];
      if (!items.length) {
        if (body) body.innerHTML = `<tr><td colspan="3">Folderi është bosh</td></tr>`;
        return;
      }
      if (body) {
        body.innerHTML = items
          .map((it) => {
            const icon = it.type === "folder" ? "📁" : "📄";
            const cls =
              it.type === "file" && !it.selectable
                ? "pi-browser-row pi-browser-row-disabled"
                : "pi-browser-row";
            const meta =
              it.type === "folder"
                ? `<td style="text-align:right">—</td><td>—</td>`
                : `<td style="text-align:right">${esc(formatBytes(it.size))}</td><td>${esc(it.modified_local || "")}</td>`;
            return `<tr class="${cls}" data-type="${esc(it.type)}" data-path="${esc(it.path)}" data-selectable="${it.selectable ? "1" : "0"}" tabindex="${it.selectable || it.type === "folder" ? "0" : "-1"}">
              <td>${icon} ${esc(it.name)}</td>${meta}
            </tr>`;
          })
          .join("");
      }
    } catch (e) {
      if (body) body.innerHTML = `<tr><td colspan="3">${esc(e.message || "Gabim")}</td></tr>`;
    }
  }

  async function loadUsbFile(filePath) {
    const msg = document.getElementById("pi-msg");
    if (!filePath) return;
    try {
      if (msg) msg.textContent = "Duke lexuar skedarin…";
      const data = await apiJson("/api/products/import/upload-from-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath }),
      });
      if (msg) msg.textContent = "";
      closeUsbBrowser();
      applyPreviewData(data);
    } catch (e) {
      if (msg) msg.textContent = e.message || String(e);
    }
  }

  function buildConfirmPayload() {
    const out = [];
    for (const r of rows) {
      if (r._removed) continue;
      if (r.status === "error") {
        out.push({
          barcode: r.barcode,
          name: r.name,
          price: r.price,
          category: r.category,
          stock: r.stock,
          action: "skip",
        });
        continue;
      }
      if (r.status === "new") {
        out.push({
          barcode: r.barcode,
          name: r.name,
          price: r.price,
          category: r.category,
          stock: r.stock,
          action: "insert",
        });
        continue;
      }
      const act = r.existsAction || globalExistsAction;
      out.push({
        barcode: r.barcode,
        name: r.name,
        price: r.price,
        category: r.category,
        stock: r.stock,
        action: act === "update" ? "update" : "skip",
      });
    }
    return out;
  }

  async function confirmImport() {
    if (importing || validImportCount() === 0) return;
    importing = true;
    const msg = document.getElementById("pi-msg");
    const bar = document.getElementById("pi-progress-bar");
    const wrap = document.getElementById("pi-progress-wrap");
    const btn = document.getElementById("pi-confirm-btn");
    if (btn) btn.disabled = true;
    if (wrap) wrap.classList.remove("hidden");
    let pct = 0;
    const tick = setInterval(() => {
      pct = Math.min(95, pct + 3);
      if (bar) bar.style.width = `${pct}%`;
    }, 120);
    try {
      const payload = {
        filename: uploadFilename || "import.csv",
        rows: buildConfirmPayload(),
      };
      const result = await apiJson("/api/products/import/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      clearInterval(tick);
      if (bar) bar.style.width = "100%";
      const resEl = document.getElementById("pi-result");
      if (resEl) {
        resEl.classList.remove("hidden");
        resEl.textContent = `U regjistruan ${result.new_count} produkte të reja. U përditësuan ${result.updated_count}. U anashkaluan ${result.skipped_count}. ${result.error_count} gabime.`;
      }
      if (msg) msg.textContent = "";
      await loadHistory();
      rows = [];
      renderTable();
      document.getElementById("pi-step-upload")?.classList.remove("hidden");
    } catch (e) {
      clearInterval(tick);
      if (msg) msg.textContent = e.message || String(e);
    } finally {
      importing = false;
      if (btn) btn.disabled = validImportCount() === 0;
      setTimeout(() => {
        if (wrap) wrap.classList.add("hidden");
        if (bar) bar.style.width = "0%";
      }, 800);
    }
  }

  async function loadHistory() {
    const body = document.getElementById("pi-history-body");
    if (!body) return;
    try {
      const data = await apiJson("/api/products/import/history");
      const list = data.history || [];
      body.innerHTML = list.length
        ? list
            .map(
              (h) => `<tr>
              <td>${esc(h.created_at)}</td>
              <td>${esc(h.filename)}</td>
              <td style="text-align:right">${Number(h.total_rows)}</td>
              <td style="text-align:right">${Number(h.new_count)}</td>
              <td style="text-align:right">${Number(h.updated_count)}</td>
              <td style="text-align:right">${Number(h.skipped_count)}</td>
              <td style="text-align:right">${Number(h.error_count)}</td>
            </tr>`
            )
            .join("")
        : `<tr><td colspan="7" class="pi-muted">Ende pa importe.</td></tr>`;
    } catch {
      body.innerHTML = `<tr><td colspan="7" class="pi-muted">Nuk u ngarkua historiku.</td></tr>`;
    }
  }

  function bindOnce() {
    const root = document.getElementById("panel-importo-produkte");
    if (!root || root.dataset.bound === "1") return;
    root.dataset.bound = "1";

    const drop = document.getElementById("pi-drop");
    const input = document.getElementById("pi-file-input");
    const pickBtn = document.getElementById("pi-pick-btn");
    const usbScanBtn = document.getElementById("pi-usb-scan-btn");
    const browserBody = document.getElementById("pi-browser-body");
    const browserClose = document.getElementById("pi-browser-close");
    const browserUp = document.getElementById("pi-browser-up");
    const browserDrives = document.getElementById("pi-browser-drives");
    const browserOverlay = document.getElementById("pi-browser-overlay");
    const sampleBtn = document.getElementById("pi-sample-btn");
    const globalSel = document.getElementById("pi-global-exists");
    const confirmBtn = document.getElementById("pi-confirm-btn");
    const tbody = document.getElementById("pi-preview-body");

    sampleBtn?.addEventListener("click", () => {
      window.location.href = "/api/products/import/sample";
    });

    pickBtn?.addEventListener("click", () => input?.click());

    usbScanBtn?.addEventListener("click", () => openUsbBrowser());

    browserClose?.addEventListener("click", () => closeUsbBrowser());
    browserOverlay?.addEventListener("click", (e) => {
      if (e.target === browserOverlay) closeUsbBrowser();
    });
    browserDrives?.addEventListener("click", () => showDriveList());
    browserUp?.addEventListener("click", () => {
      const parent = browserUp.dataset.parent;
      if (parent) showFolder(parent);
      else showDriveList();
    });

    function onBrowserRowActivate(row) {
      if (!row) return;
      const type = row.getAttribute("data-type");
      const p = row.getAttribute("data-path");
      if (!p) return;
      if (row.classList.contains("pi-browser-drive-row") || type === "folder") {
        showFolder(p);
        return;
      }
      if (type === "file" && row.getAttribute("data-selectable") === "1") {
        loadUsbFile(p);
      }
    }

    browserBody?.addEventListener("click", (e) => {
      const row = e.target.closest(".pi-browser-drive-row, .pi-browser-row");
      if (!row || row.classList.contains("pi-browser-row-disabled")) return;
      onBrowserRowActivate(row);
    });
    browserBody?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const row = e.target.closest(".pi-browser-drive-row, .pi-browser-row");
      if (!row || row.classList.contains("pi-browser-row-disabled")) return;
      e.preventDefault();
      onBrowserRowActivate(row);
    });

    input?.addEventListener("change", () => {
      const f = input.files?.[0];
      if (f) onFileSelected(f);
      input.value = "";
    });

    drop?.addEventListener("click", (e) => {
      if (e.target.closest("#pi-pick-btn")) return;
      input?.click();
    });
    drop?.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("pi-drop-hover");
    });
    drop?.addEventListener("dragleave", () => drop.classList.remove("pi-drop-hover"));
    drop?.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("pi-drop-hover");
      const f = e.dataTransfer?.files?.[0];
      if (f) onFileSelected(f);
    });

    globalSel?.addEventListener("change", () => {
      globalExistsAction = globalSel.value === "skip" ? "skip" : "update";
      rows.forEach((r) => {
        if (r.status === "exists" && !r._existsManual) r.existsAction = globalExistsAction;
      });
      renderTable();
    });

    tbody?.addEventListener("change", (e) => {
      const sel = e.target.closest(".pi-exists-action");
      if (!sel) return;
      const idx = Number(sel.dataset.idx);
      if (!Number.isFinite(idx) || !rows[idx]) return;
      rows[idx].existsAction = sel.value === "skip" ? "skip" : "update";
      rows[idx]._existsManual = true;
      renderTable();
    });

    tbody?.addEventListener("click", (e) => {
      const btn = e.target.closest(".pi-remove");
      if (!btn) return;
      const idx = Number(btn.dataset.idx);
      if (Number.isFinite(idx) && rows[idx]) {
        rows[idx]._removed = true;
        renderTable();
      }
    });

    confirmBtn?.addEventListener("click", () => confirmImport());
  }

  function onTabShow() {
    bindOnce();
    loadHistory();
  }

  window.DyqanetProductImport = { onTabShow };
})();
