/**
 * Faturat A4 shitje — admin desktop (SQLite lokale).
 * Rreshtat: tabela 11 kolona (si Blerjet / inv-lines).
 */
(function () {
  const API = "/api/admin/sales-invoices";
  const HI = window.HotelInvLines;

  const root = document.getElementById("admin-sales-invoices-root");
  const Html = window.SalesInvoiceHtml;
  if (!root || !Html || !HI) return;

  let settings = { vatEnabled: false, vatPercent: 18, companyLogoUrl: "" };
  let seller = {};
  let invoices = [];
  let menuItemsCache = [];
  let salesCatFilter = null;
  let screen = "list";
  let busy = false;
  let errorMsg = "";
  let okMsg = "";
  let previewDoc = null;
  let invoiceNumber = "";
  let editId = null;
  let guest = emptyGuest();
  let lines = [newSalesLine()];
  let date = todayYmd();
  let q = "";
  let statusFilter = "Të gjitha";

  function todayYmd() {
    return new Date().toISOString().slice(0, 10);
  }

  function emptyGuest() {
    return {
      kind: "individual",
      name: "",
      companyName: "",
      address: "",
      nui: "",
      fiscalNumber: "",
      email: "",
      phone: "",
    };
  }

  function defaultLineVat() {
    const v = settings.vatEnabled ? Number(settings.vatPercent) : 18;
    return HI.normalizeLineVat(v);
  }

  function newSalesLine() {
    return {
      menu_item_id: "",
      category: "",
      pack_qty: 1,
      pieces_per_pack: 1,
      pack_price: "",
      price_gross: "",
      discount_pct: 0,
      line_sasia: "",
      vat_rate: defaultLineVat(),
      description: "",
    };
  }

  function escHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escAttr(s) {
    return escHtml(s).replace(/'/g, "&#39;");
  }

  function euro(n) {
    return `${(Number(n) || 0).toFixed(2)} €`;
  }

  async function invApi(path, opts = {}) {
    return api(`${API}${path}`, opts);
  }

  async function ensureMenuLoaded() {
    if (menuItemsCache.length) return;
    menuItemsCache = await api("/api/menu/all");
  }

  function vatFromSettings() {
    const hasLineVat = lines.some((ln) => {
      const a = HI.invoiceLineAmountsFromLine(ln);
      return a.sumVat > 0;
    });
    return {
      enabled: !!settings.vatEnabled || hasLineVat,
      percent: Number(settings.vatPercent) || 18,
    };
  }

  function lineDescription(line) {
    const manual = String(line.description || "").trim();
    if (manual) return manual;
    const item = menuItemsCache.find((m) => String(m.id) === String(line.menu_item_id));
    return item ? String(item.name || "").trim() : "";
  }

  function salesLineToApiLine(line) {
    const amt = HI.invoiceLineAmountsFromLine(line);
    const desc = lineDescription(line);
    return {
      description: desc,
      qty: amt.sasia,
      unitPrice: amt.priceNet,
      discount: { type: "percent", value: amt.disc },
      lineTotal: amt.sumNet,
      sumNet: amt.sumNet,
      sumVat: amt.sumVat,
      sumGross: amt.sumGross,
    };
  }

  function apiLineToSalesLine(ln) {
    const qty = Number(ln.qty) || 1;
    const net = Number(ln.unitPrice) || 0;
    let disc = 0;
    if (ln.discount?.type === "percent") disc = Number(ln.discount.value) || 0;
    else if (Number(ln.discount?.value) > 0 && qty * net > 0) {
      disc = Math.min(100, (Number(ln.discount.value) / (qty * net)) * 100);
    }
    const vat = defaultLineVat();
    const gross = net > 0 ? Math.round(net * (1 + vat / 100) * 10000) / 10000 : "";
    return {
      menu_item_id: "",
      category: "",
      pack_qty: 1,
      pieces_per_pack: qty,
      line_sasia: qty,
      price_gross: gross,
      discount_pct: Math.round(disc * 100) / 100,
      vat_rate: vat,
      description: ln.description || "",
    };
  }

  function buildDoc(num, status) {
    lines.forEach((_, idx) => syncSalesLineFromDom(idx));
    const vat = vatFromSettings();
    const normLines = lines.map((ln) => salesLineToApiLine(ln)).filter((ln) => ln.description);
    const totals = Html.computeTotals(normLines, vat);
    return {
      id: editId,
      number: num,
      date,
      status: status || "final",
      guest: { ...guest },
      lines: normLines,
      vat,
      totals,
      sellerSnapshot: { ...seller },
      orderId: null,
    };
  }

  function statusLabel(s) {
    const map = { final: "Final", printed: "Printuar", emailed: "Email" };
    return map[s] || s;
  }

  async function loadAll() {
    const data = await invApi("/settings");
    settings = data.settings || settings;
    seller = data.seller || seller;
    const list = await invApi(q || statusFilter !== "Të gjitha"
      ? `?q=${encodeURIComponent(q)}&status=${encodeURIComponent(statusFilter)}`
      : "");
    invoices = list.invoices || [];
  }

  function salesCategoryList() {
    const present = new Set(
      (menuItemsCache || []).map((it) => String(it.category || "").trim()).filter(Boolean),
    );
    const ordered = [];
    if (typeof KATEGORITE !== "undefined" && Array.isArray(KATEGORITE)) {
      for (const k of KATEGORITE) if (present.has(k)) ordered.push(k);
    }
    for (const c of present) {
      if (!ordered.includes(c)) ordered.push(c);
    }
    return ordered;
  }

  function itemsForSalesDropdown(selectedId, lineCategory) {
    let items = menuItemsCache || [];
    const cat = String(lineCategory || salesCatFilter || "").trim();
    if (cat) items = items.filter((it) => String(it.category || "").trim() === cat);
    if (selectedId) {
      const sel = (menuItemsCache || []).find((m) => String(m.id) === String(selectedId));
      if (sel && !items.some((m) => String(m.id) === String(selectedId))) items = [sel, ...items];
    }
    return items;
  }

  function salesProductOptionsHtml(line) {
    const lineCat = String(line.category || salesCatFilter || "").trim();
    const items = itemsForSalesDropdown(line.menu_item_id, lineCat);
    let html = '<option value="">— Zgjidh produktin —</option>';
    if (!lineCat) {
      const byCat = new Map();
      for (const it of items) {
        const c = String(it.category || "").trim() || "Pa kategori";
        if (!byCat.has(c)) byCat.set(c, []);
        byCat.get(c).push(it);
      }
      for (const [c, list] of [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0], "sq"))) {
        html += `<optgroup label="${escHtml(c)}">`;
        for (const it of list) {
          const selected = String(it.id) === String(line.menu_item_id) ? " selected" : "";
          html += `<option value="${it.id}"${selected}>${escHtml(it.name)}</option>`;
        }
        html += "</optgroup>";
      }
    } else {
      for (const it of items) {
        const selected = String(it.id) === String(line.menu_item_id) ? " selected" : "";
        html += `<option value="${it.id}"${selected}>${escHtml(it.name)}</option>`;
      }
    }
    return html;
  }

  function salesLineVatSelectHtml(idx, selected) {
    const v = HI.normalizeLineVat(selected);
    const opts = [18, 8, 0]
      .map((r) => `<option value="${r}"${v === r ? " selected" : ""}>${r}%</option>`)
      .join("");
    return `<select class="sales-line-vat" data-idx="${idx}" title="TVSH për këtë rresht">${opts}</select>`;
  }

  function menuItemVatRate(item) {
    if (!item) return defaultLineVat();
    const raw = item.vat_category ?? item.vat_rate ?? item.vat;
    const n = Number(raw);
    if (n === 0 || n === 8 || n === 18) return n;
    if (String(raw || "").toUpperCase().includes("8")) return 8;
    if (String(raw || "").toUpperCase().includes("0")) return 0;
    return defaultLineVat();
  }

  function syncSalesLineFromDom(idx, sourceEl) {
    const line = lines[idx];
    if (!line) return;
    const sasiaInp = document.querySelector(`.sales-line-sasia[data-idx="${idx}"]`);
    const netInp = document.querySelector(`.sales-line-price-net[data-idx="${idx}"]`);
    const discInp = document.querySelector(`.sales-line-discount[data-idx="${idx}"]`);
    const packInp = document.querySelector(`.sales-line-packs[data-idx="${idx}"]`);
    const vatSel = document.querySelector(`.sales-line-vat[data-idx="${idx}"]`);
    const prodSel = document.querySelector(`.sales-line-product[data-idx="${idx}"]`);
    const src = sourceEl?.classList || { contains: () => false };

    if (prodSel) {
      line.menu_item_id = prodSel.value;
      const item = menuItemsCache.find((m) => String(m.id) === prodSel.value);
      if (item) {
        line.category = String(item.category || "").trim();
        line.description = String(item.name || "").trim();
        if (line.price_gross === "" || line.price_gross == null) {
          line.price_gross = Number(item.price) || 0;
        }
        line.vat_rate = menuItemVatRate(item);
      }
    }
    if (vatSel) line.vat_rate = HI.normalizeLineVat(vatSel.value);

    const pack_qty = Number(packInp?.value);
    const qSasia = Number(sasiaInp?.value);
    if (src.contains("sales-line-packs")) {
      if (Number.isFinite(pack_qty)) line.pack_qty = pack_qty;
      if (Number.isFinite(qSasia) && qSasia >= 0) {
        line.line_sasia = qSasia;
        if (line.pack_qty > 0) {
          line.pieces_per_pack = Math.round((qSasia / line.pack_qty) * 1000) / 1000;
        }
      } else {
        line.line_sasia = HI.lineStockQty(line);
      }
    } else if (src.contains("sales-line-sasia")) {
      if (Number.isFinite(qSasia) && qSasia >= 0) line.line_sasia = qSasia;
      const pack = Number(line.pack_qty) || 0;
      if (line.line_sasia > 0 && pack > 0) {
        line.pieces_per_pack = Math.round((line.line_sasia / pack) * 1000) / 1000;
      }
    } else {
      if (Number.isFinite(pack_qty)) line.pack_qty = pack_qty;
      if (Number.isFinite(qSasia) && qSasia >= 0) line.line_sasia = qSasia;
    }

    const net = Number(netInp?.value);
    if (Number.isFinite(net) && net >= 0) {
      const vat = HI.normalizeLineVat(line.vat_rate ?? 18);
      line.price_gross = Math.round(net * (1 + vat / 100) * 10000) / 10000;
    }
    const disc = Number(discInp?.value);
    if (Number.isFinite(disc)) line.discount_pct = Math.min(100, Math.max(0, disc));
  }

  function updateSalesInvoiceRowUi(idx) {
    const tr = document.querySelector(`#sales-lines-body tr[data-line="${idx}"]`);
    const line = lines[idx];
    if (!tr || !line) return;
    const amt = HI.invoiceLineAmountsFromLine(line);
    const set = (sel, text) => {
      const el = tr.querySelector(sel);
      if (el) el.textContent = text;
    };
    set(".sales-inv-price-gross-cell", amt.priceGross.toFixed(2));
    set(".sales-inv-sum-net", amt.sumNet.toFixed(2));
    set(".sales-inv-sum-vat", amt.sumVat.toFixed(2));
    set(".sales-inv-sum-gross", euro(amt.sumGross));
  }

  function recalcSalesGrandTotal() {
    let sum = 0;
    for (const line of lines) sum += HI.invoiceLineAmountsFromLine(line).sumGross;
    const el = document.getElementById("sales-grand-total");
    if (el) el.textContent = euro(Math.round(sum * 100) / 100);
  }

  function renderSalesCatFilter() {
    const bar = document.getElementById("sales-cat-filter");
    if (!bar) return;
    const cats = salesCategoryList();
    if (salesCatFilter && !cats.includes(salesCatFilter)) salesCatFilter = null;
    const tabs = [{ key: null, label: "Krejt" }, ...cats.map((c) => ({ key: c, label: c }))];
    bar.innerHTML = tabs
      .map((t) => {
        const active = salesCatFilter === t.key;
        const val = t.key === null ? "__all__" : encodeURIComponent(t.key);
        return `<button type="button" class="product-cat-tab${active ? " active" : ""}" data-sales-cat="${val}" role="tab" aria-selected="${active ? "true" : "false"}" style="flex:0 0 auto;white-space:nowrap;padding:0.32rem 0.7rem;font-size:0.78rem;font-weight:700;border-radius:999px;cursor:pointer;border:1px solid ${active ? "#FF6B35" : "#3a3a55"};background:${active ? "#FF6B35" : "#252538"};color:#fff">${escHtml(t.label)}</button>`;
      })
      .join("");
    bar.querySelectorAll("[data-sales-cat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const raw = btn.dataset.salesCat;
        salesCatFilter = raw === "__all__" ? null : decodeURIComponent(raw || "");
        renderSalesCatFilter();
        renderSalesFormLines();
      });
    });
  }

  function renderSalesFormLines() {
    const tbody = document.getElementById("sales-lines-body");
    if (!tbody) return;
    tbody.innerHTML = lines.map((line, idx) => {
      const lineCat = String(line.category || "").trim() || (() => {
        const sel = menuItemsCache.find((m) => String(m.id) === String(line.menu_item_id));
        return sel ? String(sel.category || "").trim() : (salesCatFilter || "");
      })();
      if (!line.category && lineCat) line.category = lineCat;
      const amt = HI.invoiceLineAmountsFromLine(line);
      const packs = line.pack_qty !== "" && line.pack_qty != null ? line.pack_qty : "";
      const netVal = HI.lineNetPerPiece(line);
      const disc = line.discount_pct != null ? line.discount_pct : 0;
      const delBtn =
        lines.length > 1
          ? `<button type="button" class="btn btn-ghost btn-sm sales-line-remove" data-idx="${idx}" title="Fshi rreshtin">×</button>`
          : "";
      return `
        <tr data-line="${idx}">
          <td class="c">${idx + 1}${delBtn}</td>
          <td class="purchase-inv-desc-cell">
            <select class="sales-line-product" data-idx="${idx}">${salesProductOptionsHtml(line)}</select>
          </td>
          <td class="c purchase-inv-pako-cell"><input type="number" class="sales-line-packs" data-idx="${idx}" min="0" step="any" value="${packs}" title="Pako"></td>
          <td class="n"><input type="number" class="sales-line-sasia" data-idx="${idx}" min="0" step="any" value="${amt.sasia}" title="Sasia (copë totale)"></td>
          <td class="n"><input type="number" class="sales-line-price-net" data-idx="${idx}" min="0" step="any" value="${netVal ? netVal : ""}" title="Çmimi pa TVSH / copë"></td>
          <td class="n"><input type="number" class="sales-line-discount" data-idx="${idx}" min="0" max="100" step="any" value="${disc}" title="Zbritja %"></td>
          <td class="n sales-inv-price-gross-cell">${amt.priceGross.toFixed(2)}</td>
          <td class="n sales-inv-sum-net">${amt.sumNet.toFixed(2)}</td>
          <td class="c">${salesLineVatSelectHtml(idx, line.vat_rate)}</td>
          <td class="n sales-inv-sum-vat">${amt.sumVat.toFixed(2)}</td>
          <td class="n sales-inv-sum-gross">${euro(amt.sumGross)}</td>
        </tr>`;
    }).join("");

    const onRowInput = (e) => {
      const idx = Number(e.target?.dataset?.idx);
      if (!Number.isFinite(idx)) return;
      syncSalesLineFromDom(idx, e.target);
      updateSalesInvoiceRowUi(idx);
      recalcSalesGrandTotal();
    };
    tbody.querySelectorAll("input, select").forEach((inp) => {
      inp.addEventListener("input", onRowInput);
      inp.addEventListener("change", onRowInput);
    });
    tbody.querySelectorAll(".sales-line-product").forEach((sel) => {
      sel.addEventListener("change", () => {
        const idx = Number(sel.dataset.idx);
        syncSalesLineFromDom(idx, sel);
        renderSalesFormLines();
      });
    });
    tbody.querySelectorAll(".sales-line-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.idx);
        lines.splice(idx, 1);
        renderSalesFormLines();
      });
    });
    recalcSalesGrandTotal();
  }

  function renderSettingsCard() {
    return `
    <div class="card inv-settings-card">
      <div class="card-title">Fatura A4 — cilësimet</div>
      <p class="purchases-panel-sub">Shitësi: emri, NUI, NF, adresa nga Admin → Fiskalizimi / lokal.</p>
      <div class="link-row inv-logo-row" style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap">
        <label>Logo</label>
        ${settings.companyLogoUrl ? `<img src="${escAttr(settings.companyLogoUrl)}" alt="" style="max-height:48px" />` : "<span class=\"purchases-panel-sub\">Pa logo</span>"}
        <input type="file" accept="image/*" id="inv-logo-file" ${busy ? "disabled" : ""} />
        <span class="purchases-panel-sub">Maksimumi 2 MB</span>
      </div>
      <div class="link-row" style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;margin-top:0.5rem">
        <label><input type="checkbox" id="inv-vat-enabled" ${settings.vatEnabled ? "checked" : ""} /> TVSH në faturë</label>
        <input type="number" id="inv-vat-percent" min="0" max="100" step="0.01" value="${Number(settings.vatPercent) || 18}" style="max-width:5rem" /> %
        <button type="button" class="btn btn-ghost btn-sm" id="inv-save-vat">Ruaj TVSH</button>
      </div>
    </div>`;
  }

  function renderList() {
    return `
    ${renderSettingsCard()}
    <div class="card" style="margin-top:0.75rem">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>Faturat shitje (A4)</span>
        <button type="button" class="btn btn-primary btn-sm" id="inv-new">+ Faturë e re</button>
      </div>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin:0.5rem 0">
        <input id="inv-q" placeholder="Kërko…" value="${escAttr(q)}" />
        <select id="inv-status-filter">
          ${["Të gjitha", "final", "printed", "emailed"].map((s) =>
    `<option value="${s}" ${statusFilter === s ? "selected" : ""}>${s === "Të gjitha" ? s : statusLabel(s)}</option>`).join("")}
        </select>
        <button type="button" class="btn btn-ghost btn-sm" id="inv-reload">Rifresko</button>
      </div>
      <table class="dashboard-top-table">
        <thead><tr><th>Numri</th><th>Data</th><th>Mysafir / Klient</th><th>Totali</th><th>Statusi</th><th></th></tr></thead>
        <tbody>
          ${invoices.length ? invoices.map((inv) => {
            const g = inv.guest || {};
            return `<tr>
            <td>${Html.esc(inv.number)}</td>
            <td>${Html.esc(inv.date)}</td>
            <td>${Html.esc(g.kind === "company" ? g.companyName : g.name)}</td>
            <td>${euro(inv.totals?.grandTotal)}</td>
            <td>${statusLabel(inv.status)}</td>
            <td>
              <button type="button" class="btn btn-ghost btn-sm inv-view" data-id="${escAttr(inv.id)}">Shiko</button>
              <button type="button" class="btn btn-ghost btn-sm inv-del" data-id="${escAttr(inv.id)}">Fshi</button>
            </td>
          </tr>`;
          }).join("") : "<tr><td colspan=\"6\">Asnjë faturë.</td></tr>"}
        </tbody>
      </table>
    </div>`;
  }

  function renderEdit() {
    const b2b = guest.kind === "company";
    return `
    <button type="button" class="btn btn-ghost btn-sm" id="inv-back-list">← Lista</button>
    <h2 class="reports-panel-title">${editId ? "Ndrysho faturën" : "Faturë e re"}</h2>
    ${invoiceNumber ? `<p class="purchases-panel-sub">Numri: <strong>${Html.esc(invoiceNumber)}</strong></p>` : ""}
    <div class="card">
      <div class="card-title">Mysafiri / Klienti</div>
      <div style="margin-bottom:0.5rem">
        <label><input type="radio" name="inv-guest-kind" value="individual" ${!b2b ? "checked" : ""} /> Mysafir</label>
        <label style="margin-left:1rem"><input type="radio" name="inv-guest-kind" value="company" ${b2b ? "checked" : ""} /> Klient (B2B)</label>
      </div>
      ${b2b ? `<div class="form-row"><label>Emri i kompanisë</label><input id="inv-company" value="${escAttr(guest.companyName)}" /></div>
      <div class="form-row"><label>Kontakt</label><input id="inv-name" value="${escAttr(guest.name)}" /></div>` :
    `<div class="form-row"><label>Emri</label><input id="inv-name" value="${escAttr(guest.name)}" /></div>`}
      <div class="form-row"><label>Adresa</label><input id="inv-address" value="${escAttr(guest.address)}" /></div>
      <div class="form-row"><label>NUI</label><input id="inv-nui" value="${escAttr(guest.nui)}" /></div>
      <div class="form-row"><label>NF</label><input id="inv-nf" value="${escAttr(guest.fiscalNumber)}" /></div>
      <div class="form-row"><label>Email</label><input type="email" id="inv-email" value="${escAttr(guest.email)}" /></div>
      <div class="form-row"><label>Telefoni</label><input id="inv-phone" value="${escAttr(guest.phone)}" /></div>
      <div class="form-row"><label>Data</label><input type="date" id="inv-date" value="${escAttr(date)}" /></div>
    </div>
    <div class="card sales-inv-lines-card" style="margin-top:0.75rem">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem">
        <span>Artikuj</span>
        <button type="button" class="btn btn-ghost btn-sm" id="inv-add-line">+ Shto rresht</button>
      </div>
      <p class="purchases-panel-sub">Zgjidhni produktin nga menuja ose ndryshoni pako, sasi, çmime dhe TVSH — si te Blerjet.</p>
      <div id="sales-cat-filter" class="product-cat-filter purchase-cat-filter" role="tablist" aria-label="Filtro produktet" style="display:flex;flex-wrap:nowrap;gap:0.4rem;overflow-x:auto;margin:0.35rem 0 0.65rem;padding:0.15rem 0;min-height:2rem"></div>
      <div class="sales-lines-wrap receipt-scan-table-scroll">
        <table class="inv-lines hotel-inv-lines sales-inv-lines">
          <thead>
            <tr>
              <th>Nr</th>
              <th>Përshkrimi</th>
              <th>Pako</th>
              <th>Sasia</th>
              <th>Çmimi<br>pa TVSH</th>
              <th>Zbritja<br>%</th>
              <th>Çmimi<br>me TVSH</th>
              <th>Shuma<br>pa TVSH</th>
              <th>TVSH<br>%</th>
              <th>Shuma<br>TVSH</th>
              <th>Totali<br>me TVSH</th>
            </tr>
          </thead>
          <tbody id="sales-lines-body"></tbody>
        </table>
      </div>
      <div class="purchase-form-total">
        <span>Totali i faturës</span>
        <strong id="sales-grand-total">0.00 €</strong>
      </div>
    </div>
    <button type="button" class="btn btn-primary" id="inv-go-preview" ${busy ? "disabled" : ""}>
      ${busy ? "Duke alokuar…" : "Vazhdo te preview"}
    </button>`;
  }

  function renderPreview() {
    const em = String((previewDoc?.guest || {}).email || "").trim();
    return `
    <button type="button" class="btn btn-ghost btn-sm" id="inv-back-edit">← Kthehu</button>
    <div style="display:flex;gap:0.5rem;align-items:center;margin:0.5rem 0;flex-wrap:wrap">
      <span class="purchases-panel-sub">${em ? `PDF → ${Html.esc(em)}` : "⚠ Mungon email për dërgim"}</span>
      <button type="button" class="btn btn-ghost" id="inv-print" ${busy ? "disabled" : ""}>Printo</button>
      <button type="button" class="btn btn-primary" id="inv-email-btn" ${busy || !em ? "disabled" : ""}>
        ${busy ? "Duke dërguar…" : "Dërgo me Email"}
      </button>
    </div>
    <div class="inv-preview-paper" style="background:#fff;color:#111;border-radius:8px;overflow:hidden;min-height:420px">
      <iframe title="Preview faturë" class="inv-preview-frame" sandbox="allow-same-origin" style="width:100%;min-height:520px;border:0"></iframe>
    </div>`;
  }

  function readGuestFromDom() {
    guest.kind = root.querySelector('input[name="inv-guest-kind"]:checked')?.value || "individual";
    guest.name = document.getElementById("inv-name")?.value || "";
    guest.companyName = document.getElementById("inv-company")?.value || "";
    guest.address = document.getElementById("inv-address")?.value || "";
    guest.nui = document.getElementById("inv-nui")?.value || "";
    guest.fiscalNumber = document.getElementById("inv-nf")?.value || "";
    guest.email = document.getElementById("inv-email")?.value || "";
    guest.phone = document.getElementById("inv-phone")?.value || "";
    date = document.getElementById("inv-date")?.value || date;
  }

  async function goPreview() {
    errorMsg = "";
    readGuestFromDom();
    lines.forEach((_, idx) => syncSalesLineFromDom(idx));
    const nameOk = guest.kind === "company" ? guest.companyName.trim() : guest.name.trim();
    if (!nameOk) {
      errorMsg = guest.kind === "company" ? "Vendosni emrin e kompanisë." : "Vendosni emrin e mysafirit.";
      render();
      return;
    }
    if (!lines.some((ln) => lineDescription(ln))) {
      errorMsg = "Shtoni të paktën një artikull (zgjidhni produktin).";
      render();
      return;
    }
    busy = true;
    render();
    try {
      if (!invoiceNumber) {
        const data = await invApi("/next-number", { method: "POST", body: "{}" });
        invoiceNumber = data.number;
      }
      previewDoc = buildDoc(invoiceNumber, "final");
      const saved = await invApi(editId ? `/${editId}` : "", {
        method: editId ? "PUT" : "POST",
        body: JSON.stringify({ ...previewDoc, number: invoiceNumber }),
      });
      if (saved.invoice?.id) editId = saved.invoice.id;
      screen = "preview";
    } catch (e) {
      errorMsg = e.message || "Gabim preview.";
    } finally {
      busy = false;
      render();
    }
  }

  async function sendEmail() {
    if (!previewDoc) return;
    const to = String(previewDoc.guest?.email || "").trim();
    if (!to) {
      errorMsg = "Vendosni email-in.";
      render();
      return;
    }
    busy = true;
    render();
    try {
      await invApi("/send-email", {
        method: "POST",
        body: JSON.stringify({ invoice: previewDoc, to }),
      });
      okMsg = `Email u dërgua te ${to}.`;
      previewDoc = { ...previewDoc, status: "emailed" };
    } catch (e) {
      const m = String(e?.message || "");
      errorMsg =
        m === "Nuk mund të dërgohet email." || /RESEND|Resend|resend\.com/i.test(m)
          ? "Nuk mund të dërgohet email."
          : m || "Nuk mund të dërgohet email.";
    } finally {
      busy = false;
      render();
    }
  }

  function openNew() {
    screen = "edit";
    editId = null;
    invoiceNumber = "";
    guest = emptyGuest();
    salesCatFilter = null;
    lines = [newSalesLine()];
    date = todayYmd();
    errorMsg = "";
    okMsg = "";
    render();
    ensureMenuLoaded()
      .then(() => {
        renderSalesCatFilter();
        renderSalesFormLines();
      })
      .catch(() => renderSalesFormLines());
  }

  function openView(inv) {
    previewDoc = {
      ...inv,
      sellerSnapshot: inv.sellerSnapshot || seller,
    };
    screen = "preview";
    render();
  }

  function bindEditScreen() {
    renderSalesCatFilter();
    renderSalesFormLines();
    root.querySelectorAll('input[name="inv-guest-kind"]').forEach((r) => {
      r.onchange = () => { readGuestFromDom(); render(); };
    });
    document.getElementById("inv-add-line")?.addEventListener("click", () => {
      lines.push(newSalesLine());
      renderSalesFormLines();
    });
    document.getElementById("inv-go-preview")?.addEventListener("click", goPreview);
    document.getElementById("inv-back-list")?.addEventListener("click", () => {
      screen = "list";
      loadAll().then(render);
    });
  }

  function render() {
    let body = "";
    if (errorMsg) body += `<p style="color:#f87171">${Html.esc(errorMsg)}</p>`;
    if (okMsg) body += `<p style="color:#86efac">${Html.esc(okMsg)}</p>`;
    if (screen === "list") body += renderList();
    else if (screen === "edit") body += renderEdit();
    else if (screen === "preview") body += renderPreview();
    root.innerHTML = body;

    if (screen === "list") {
      document.getElementById("inv-new")?.addEventListener("click", openNew);
      document.getElementById("inv-reload")?.addEventListener("click", () => {
        loadAll().then(render).catch((e) => { errorMsg = e.message; render(); });
      });
      document.getElementById("inv-q")?.addEventListener("change", (e) => { q = e.target.value; });
      document.getElementById("inv-status-filter")?.addEventListener("change", (e) => {
        statusFilter = e.target.value;
        loadAll().then(render).catch((err) => { errorMsg = err.message; render(); });
      });
      document.getElementById("inv-save-vat")?.addEventListener("click", async () => {
        try {
          const vatOn = document.getElementById("inv-vat-enabled")?.checked;
          const pct = document.getElementById("inv-vat-percent")?.value;
          const data = await invApi("/settings", {
            method: "PUT",
            body: JSON.stringify({ vatEnabled: vatOn, vatPercent: Number(pct) }),
          });
          settings = data.settings;
          okMsg = "TVSH u ruajt.";
          errorMsg = "";
        } catch (e) {
          errorMsg = e.message;
        }
        render();
      });
      document.getElementById("inv-logo-file")?.addEventListener("change", async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
          errorMsg = "Maksimumi 2 MB.";
          render();
          return;
        }
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
        try {
          const data = await invApi("/upload-logo", {
            method: "POST",
            body: JSON.stringify({
              imageBase64: btoa(binary),
              contentType: file.type || "image/png",
            }),
          });
          settings.companyLogoUrl = data.publicUrl;
          seller.logoUrl = data.publicUrl;
          okMsg = "Logo u ruajt.";
        } catch (err) {
          errorMsg = err.message;
        }
        render();
      });
      root.querySelectorAll(".inv-view").forEach((btn) => {
        btn.addEventListener("click", () => {
          const inv = invoices.find((i) => String(i.id) === btn.dataset.id);
          if (inv) openView(inv);
        });
      });
      root.querySelectorAll(".inv-del").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("Fshi këtë faturë?")) return;
          try {
            await invApi(`/${btn.dataset.id}`, { method: "DELETE" });
            await loadAll();
            okMsg = "U fshi.";
          } catch (e) {
            errorMsg = e.message;
          }
          render();
        });
      });
    }

    if (screen === "edit") {
      ensureMenuLoaded()
        .then(() => bindEditScreen())
        .catch(() => bindEditScreen());
    }

    if (screen === "preview") {
      const frame = root.querySelector(".inv-preview-frame");
      if (frame && previewDoc) {
        frame.srcdoc = Html.buildInvoiceHtml(previewDoc);
      }
      document.getElementById("inv-print")?.addEventListener("click", () => {
        if (previewDoc) Html.openPrintWindow(previewDoc);
      });
      document.getElementById("inv-email-btn")?.addEventListener("click", sendEmail);
      document.getElementById("inv-back-edit")?.addEventListener("click", () => {
        screen = "edit";
        if (previewDoc) {
          guest = { ...emptyGuest(), ...previewDoc.guest };
          lines = (previewDoc.lines || []).map((ln) => apiLineToSalesLine(ln));
          if (!lines.length) lines = [newSalesLine()];
          date = previewDoc.date;
          invoiceNumber = previewDoc.number;
        }
        render();
        ensureMenuLoaded()
          .then(() => bindEditScreen())
          .catch(() => bindEditScreen());
      });
    }
  }

  async function initAdminSalesInvoices() {
    errorMsg = "";
    okMsg = "";
    screen = "list";
    try {
      await loadAll();
      render();
    } catch (e) {
      root.innerHTML = `<p style="color:#f87171">${Html.esc(e.message || "Nuk u ngarkua moduli Faturat.")}</p>`;
    }
  }

  window.initAdminSalesInvoices = initAdminSalesInvoices;
})();
