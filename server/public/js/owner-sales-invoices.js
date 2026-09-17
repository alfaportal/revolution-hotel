/**
 * Faturat A4 shitje — panel pronari (listë / form / preview).
 */
(function () {
  const STORE_KEY = "revolution-hotel-sales-invoices-v1";
  const API = "/api/owner/sales-invoices";
  const PRESETS = [
    "Dhomë / natë",
    "Restorant",
    "Minibar",
    "Transport",
    "Parkim",
    "SPA / wellness",
    "Konferencë",
    "Lavanderi",
  ];

  const root = document.getElementById("owner-sales-invoices-root");
  if (!root) return;

  const Html = window.OwnerSalesInvoiceHtml;
  let clientId = "";
  let settings = { vatEnabled: false, vatPercent: 18, companyLogoUrl: "" };
  let seller = {};
  let screen = "list";
  let busy = false;
  let errorMsg = "";
  let okMsg = "";
  let previewDoc = null;
  let invoiceNumber = "";
  let editId = null;

  let store = { guests: [], invoices: [] };
  let guest = emptyGuest();
  let lines = [emptyLine()];
  let date = todayYmd();
  let guestPick = "";
  let q = "";
  let statusFilter = "Të gjitha";

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

  function emptyLine() {
    return { description: "", qty: 1, unitPrice: "", discount: { type: "amount", value: 0 } };
  }

  function todayYmd() {
    return new Date().toISOString().slice(0, 10);
  }

  function euro(n) {
    return `${(Number(n) || 0).toFixed(2)} €`;
  }

  function normalizeStoredInvoice(inv) {
    if (!inv) return inv;
    const g = inv.guest || inv.buyer;
    if (!g) return inv;
    const next = { ...inv, guest: g };
    if (next.buyer) delete next.buyer;
    return next;
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const guests = Array.isArray(parsed.guests)
        ? parsed.guests
        : (Array.isArray(parsed.buyers) ? parsed.buyers : []);
      const invoices = (Array.isArray(parsed.invoices) ? parsed.invoices : [])
        .map(normalizeStoredInvoice);
      return {
        clientId: clientId || "",
        guests,
        invoices,
      };
    } catch {
      return { clientId, guests: [], invoices: [] };
    }
  }

  function saveStore() {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      clientId,
      guests: store.guests,
      invoices: store.invoices.map(normalizeStoredInvoice),
    }));
  }

  function invoiceGuest(inv) {
    return inv?.guest || inv?.buyer || {};
  }

  async function invApi(path, opts = {}) {
    return api(`${API}${path}`, opts);
  }

  function vatFromSettings() {
    return {
      enabled: !!settings.vatEnabled,
      percent: Number(settings.vatPercent) || 18,
    };
  }

  function buildDoc(num, status) {
    const vat = vatFromSettings();
    const normLines = lines.map((ln) => ({
      ...ln,
      qty: Number(ln.qty) || 0,
      unitPrice: Number(ln.unitPrice) || 0,
      lineTotal: Html.lineTotal(ln),
    }));
    const totals = Html.computeTotals(normLines, vat);
    return {
      id: editId || `inv-${Date.now()}`,
      number: num,
      date,
      status: status || "final",
      guest: { ...guest },
      lines: normLines,
      vat,
      totals,
      sellerSnapshot: { ...seller },
    };
  }

  function upsertGuest(g) {
    const id = g.id || `gst-${Date.now()}`;
    const row = { ...g, id };
    const idx = store.guests.findIndex((x) => x.id === id);
    if (idx >= 0) store.guests[idx] = row;
    else store.guests.unshift(row);
    saveStore();
  }

  function upsertInvoice(inv) {
    const idx = store.invoices.findIndex((i) => i.id === inv.id);
    if (idx >= 0) store.invoices[idx] = inv;
    else store.invoices.unshift(inv);
    saveStore();
  }

  function filteredInvoices() {
    let list = [...store.invoices];
    if (statusFilter && statusFilter !== "Të gjitha") {
      list = list.filter((i) => i.status === statusFilter);
    }
    const qq = q.trim().toLowerCase();
    if (qq) {
      list = list.filter((i) =>
        String(i.number || "").toLowerCase().includes(qq)
        || String(invoiceGuest(i).name || "").toLowerCase().includes(qq)
        || String(invoiceGuest(i).companyName || "").toLowerCase().includes(qq));
    }
    return list;
  }

  function statusLabel(s) {
    const map = { final: "Final", printed: "Printuar", emailed: "Email" };
    return map[s] || s;
  }

  async function loadSettings() {
    const data = await invApi("/settings");
    if (data.clientId) clientId = data.clientId;
    settings = data.settings || settings;
    seller = data.seller || seller;
  }

  async function saveVatSettings() {
    const vatOn = document.getElementById("inv-vat-enabled")?.checked;
    const pct = document.getElementById("inv-vat-percent")?.value;
    const data = await invApi("/settings", {
      method: "PUT",
      body: JSON.stringify({ vatEnabled: vatOn, vatPercent: Number(pct) }),
    });
    settings = data.settings;
    okMsg = "TVSH u ruajt.";
    render();
  }

  async function uploadLogo(file) {
    if (!file) return;
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    const imageBase64 = btoa(binary);
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const data = await invApi("/upload-logo", {
      method: "POST",
      body: JSON.stringify({
        imageBase64,
        contentType: file.type || "image/png",
        extension: ext,
      }),
    });
    settings.companyLogoUrl = data.publicUrl;
    seller.logoUrl = data.publicUrl;
    okMsg = "Logo u ngarkua.";
    render();
  }

  async function goPreview() {
    errorMsg = "";
    const nameOk = guest.kind === "company"
      ? String(guest.companyName || "").trim()
      : String(guest.name || "").trim();
    if (!nameOk) {
      errorMsg = guest.kind === "company"
        ? "Vendosni emrin e kompanisë (klient B2B)."
        : "Vendosni emrin e mysafirit.";
      render();
      return;
    }
    if (!lines.some((ln) => String(ln.description || "").trim())) {
      errorMsg = "Shtoni të paktën një artikull.";
      render();
      return;
    }
    if (!navigator.onLine) {
      errorMsg = "Pa internet nuk alokohet numri. Lidhu online.";
      render();
      return;
    }
    busy = true;
    render();
    try {
      let num = invoiceNumber;
      if (!num) {
        const data = await invApi("/next-number", { method: "POST", body: "{}" });
        num = data.number;
        invoiceNumber = num;
      }
      previewDoc = buildDoc(num, "final");
      upsertGuest({ ...guest, id: guest.id || `gst-${Date.now()}` });
      screen = "preview";
    } catch (e) {
      errorMsg = e.message || "Numri nuk u alokua.";
    } finally {
      busy = false;
      render();
    }
  }

  async function sendEmail() {
    if (!previewDoc) return;
    const to = String(invoiceGuest(previewDoc).email || "").trim();
    if (!to) {
      errorMsg = "Vendosni email-in e mysafirit/klientit.";
      render();
      return;
    }
    busy = true;
    errorMsg = "";
    okMsg = "";
    render();
    try {
      await invApi("/send-email", {
        method: "POST",
        body: JSON.stringify({ invoice: previewDoc, to }),
      });
      const updated = { ...previewDoc, status: "emailed", emailedAt: new Date().toISOString() };
      upsertInvoice(updated);
      previewDoc = updated;
      okMsg = `Email u dërgua te ${to}. Kontrollo Spam.`;
    } catch (e) {
      errorMsg = e.message || "Dërgimi dështoi.";
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
    lines = [emptyLine()];
    date = todayYmd();
    guestPick = "";
    errorMsg = "";
    okMsg = "";
    render();
  }

  function openEdit(inv) {
    screen = "edit";
    editId = inv.id;
    invoiceNumber = inv.number;
    guest = { ...emptyGuest(), ...invoiceGuest(inv) };
    lines = inv.lines.map((ln) => ({
      description: ln.description,
      qty: ln.qty,
      unitPrice: ln.unitPrice,
      discount: ln.discount || { type: "amount", value: 0 },
    }));
    date = inv.date || todayYmd();
    render();
  }

  function applyGuestPick(id) {
    guestPick = id;
    const g = store.guests.find((x) => x.id === id);
    if (g) guest = { ...emptyGuest(), ...g };
    render();
  }

  function escAttr(s) {
    return String(s ?? "").replace(/"/g, "&quot;");
  }

  function renderSettingsCard() {
    return `
    <div class="card inv-settings-card">
      <div class="card-title">Fatura A4 — cilësimet</div>
      <p class="links-hint">Emri, NUI, NF (tvsh_nr), adresa, telefoni merren nga cilësimet e biznesit (POS / profili).</p>
      <div class="link-row inv-logo-row">
        <label>Logo</label>
        ${settings.companyLogoUrl ? `<img src="${escAttr(settings.companyLogoUrl)}" alt="" class="inv-logo-settings-preview" />` : "<span class=\"links-hint\">Pa logo</span>"}
        <input type="file" accept="image/*" id="inv-logo-file" ${busy ? "disabled" : ""} />
      </div>
      <div class="link-row">
        <label><input type="checkbox" id="inv-vat-enabled" ${settings.vatEnabled ? "checked" : ""} /> TVSH në faturë</label>
        <input type="number" id="inv-vat-percent" min="0" max="100" step="0.01" value="${Number(settings.vatPercent) || 18}" style="max-width:5rem" /> %
        <button type="button" class="btn btn-ghost btn-sm" id="inv-save-vat">Ruaj TVSH</button>
      </div>
    </div>`;
  }

  function renderList() {
    const rows = filteredInvoices();
    return `
    ${renderSettingsCard()}
    <div class="card" style="margin-top:0.75rem">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>Faturat (lokale)</span>
        <button type="button" class="btn btn-primary btn-sm" id="inv-new">+ Faturë e re</button>
      </div>
      <div class="inv-filters" style="display:flex;gap:0.5rem;flex-wrap:wrap;margin:0.5rem 0">
        <input id="inv-q" placeholder="Kërko…" value="${escAttr(q)}" />
        <select id="inv-status-filter">
          ${["Të gjitha", "final", "printed", "emailed"].map((s) =>
    `<option value="${s}" ${statusFilter === s ? "selected" : ""}>${s === "Të gjitha" ? s : statusLabel(s)}</option>`).join("")}
        </select>
      </div>
      <table class="data-table">
        <thead><tr><th>Numri</th><th>Data</th><th>Mysafir / Klient</th><th>Totali</th><th>Statusi</th><th></th></tr></thead>
        <tbody>
          ${rows.length ? rows.map((inv) => {
            const g = invoiceGuest(inv);
            return `<tr>
            <td>${Html.esc(inv.number)}</td>
            <td>${Html.esc(inv.date)}</td>
            <td>${Html.esc(g.kind === "company" ? g.companyName : g.name)}</td>
            <td>${euro(inv.totals?.grandTotal)}</td>
            <td>${statusLabel(inv.status)}</td>
            <td>
              <button type="button" class="btn btn-ghost btn-sm inv-view" data-id="${escAttr(inv.id)}">Shiko</button>
              <button type="button" class="btn btn-ghost btn-sm inv-edit" data-id="${escAttr(inv.id)}">Ndrysho</button>
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
    <h2 class="card-title">${editId ? "Ndrysho faturën" : "Faturë e re"}</h2>
    ${invoiceNumber ? `<p class="links-hint">Numri: <strong>${Html.esc(invoiceNumber)}</strong></p>` : ""}
    <div class="card">
      <div class="card-title">Mysafiri / Klienti</div>
      <div class="link-row">
        <label><input type="radio" name="inv-guest-kind" value="individual" ${!b2b ? "checked" : ""} /> Mysafir</label>
        <label><input type="radio" name="inv-guest-kind" value="company" ${b2b ? "checked" : ""} /> Klient (B2B)</label>
      </div>
      ${store.guests.length ? `<div class="link-row"><label>Zgjidh mysafir/klient të ruajtur</label>
        <select id="inv-guest-pick"><option value="">— Manual —</option>
        ${store.guests.map((g) => `<option value="${escAttr(g.id)}" ${guestPick === g.id ? "selected" : ""}>${Html.esc(g.kind === "company" ? g.companyName : g.name)}</option>`).join("")}
        </select></div>` : ""}
      ${b2b ? `<div class="link-row"><label>Emri i kompanisë</label><input id="inv-company" value="${escAttr(guest.companyName)}" /></div>
      <div class="link-row"><label>Kontakt / emri</label><input id="inv-name" value="${escAttr(guest.name)}" /></div>` :
    `<div class="link-row"><label>Emri</label><input id="inv-name" value="${escAttr(guest.name)}" /></div>`}
      <div class="link-row"><label>Adresa</label><input id="inv-address" value="${escAttr(guest.address)}" /></div>
      <div class="link-row"><label>NUI</label><input id="inv-nui" value="${escAttr(guest.nui)}" /></div>
      <div class="link-row"><label>NF</label><input id="inv-nf" value="${escAttr(guest.fiscalNumber)}" /></div>
      <div class="link-row"><label>Email</label><input type="email" id="inv-email" value="${escAttr(guest.email)}" /></div>
      <div class="link-row"><label>Telefoni</label><input id="inv-phone" value="${escAttr(guest.phone)}" /></div>
      <div class="link-row"><label>Data</label><input type="date" id="inv-date" value="${escAttr(date)}" /></div>
    </div>
    <div class="card" style="margin-top:0.75rem">
      <div class="card-title">Artikuj (çmimet neto)</div>
      <div class="link-row">
        <label>Shto shpejt:</label>
        <select id="inv-preset"><option value="">—</option>${PRESETS.map((p) => `<option value="${escAttr(p)}">${Html.esc(p)}</option>`).join("")}</select>
      </div>
      <table class="data-table inv-lines-table">
        <thead><tr><th>Përshkrimi</th><th>Sasia</th><th>Çmimi neto</th><th>Zbritja €</th><th></th></tr></thead>
        <tbody id="inv-lines-body"></tbody>
      </table>
      <button type="button" class="btn btn-ghost btn-sm" id="inv-add-line">+ Rresht</button>
      <p class="links-hint">TVSH: ${settings.vatEnabled ? `ON · ${settings.vatPercent}%` : "OFF"}</p>
    </div>
    <button type="button" class="btn btn-primary" id="inv-go-preview" ${busy ? "disabled" : ""}>
      ${busy ? "Duke alokuar…" : "Vazhdo te preview"}
    </button>
    <p class="links-hint">Pas preview: Printo dhe Dërgo me Email (PDF).</p>`;
  }

  function renderPreview() {
    const em = String(invoiceGuest(previewDoc).email || "").trim();
    return `
    <button type="button" class="btn btn-ghost btn-sm" id="inv-back-edit">← Kthehu</button>
    <div class="inv-preview-toolbar" style="display:flex;gap:0.5rem;align-items:center;margin:0.5rem 0;flex-wrap:wrap">
      <span class="links-hint">${em ? `PDF → ${Html.esc(em)}` : "⚠ Mungon email i mysafirit/klientit"}</span>
      <button type="button" class="btn btn-ghost" id="inv-print" ${busy ? "disabled" : ""}>Printo</button>
      <button type="button" class="btn btn-primary" id="inv-email" ${busy || !em ? "disabled" : ""}>
        ${busy ? "Duke dërguar…" : "Dërgo me Email"}
      </button>
    </div>
    <div class="inv-preview-paper">
      <iframe title="Preview faturë" class="inv-preview-frame" sandbox="allow-same-origin"></iframe>
    </div>`;
  }

  function renderLinesBody() {
    const tbody = document.getElementById("inv-lines-body");
    if (!tbody) return;
    tbody.innerHTML = lines.map((ln, idx) => `
      <tr data-idx="${idx}">
        <td><input class="inv-ln-desc" data-idx="${idx}" value="${escAttr(ln.description)}" /></td>
        <td><input type="number" class="inv-ln-qty" data-idx="${idx}" min="0" step="0.01" value="${ln.qty}" /></td>
        <td><input type="number" class="inv-ln-price" data-idx="${idx}" min="0" step="0.01" value="${ln.unitPrice}" /></td>
        <td><input type="number" class="inv-ln-disc" data-idx="${idx}" min="0" step="0.01" value="${ln.discount?.value || 0}" /></td>
        <td><button type="button" class="btn btn-ghost btn-sm inv-rm-line" data-idx="${idx}">✕</button></td>
      </tr>`).join("");
  }

  function bindLineInputs() {
    root.querySelectorAll(".inv-ln-desc").forEach((el) => {
      el.oninput = () => { lines[+el.dataset.idx].description = el.value; };
    });
    root.querySelectorAll(".inv-ln-qty").forEach((el) => {
      el.oninput = () => { lines[+el.dataset.idx].qty = el.value; };
    });
    root.querySelectorAll(".inv-ln-price").forEach((el) => {
      el.oninput = () => { lines[+el.dataset.idx].unitPrice = el.value; };
    });
    root.querySelectorAll(".inv-ln-disc").forEach((el) => {
      el.oninput = () => {
        lines[+el.dataset.idx].discount = { type: "amount", value: Number(el.value) || 0 };
      };
    });
    root.querySelectorAll(".inv-rm-line").forEach((el) => {
      el.onclick = () => {
        if (lines.length <= 1) return;
        lines.splice(+el.dataset.idx, 1);
        render();
      };
    });
  }

  function readGuestFromDom() {
    const kind = root.querySelector('input[name="inv-guest-kind"]:checked')?.value || "individual";
    guest.kind = kind;
    guest.name = document.getElementById("inv-name")?.value || "";
    guest.companyName = document.getElementById("inv-company")?.value || "";
    guest.address = document.getElementById("inv-address")?.value || "";
    guest.nui = document.getElementById("inv-nui")?.value || "";
    guest.fiscalNumber = document.getElementById("inv-nf")?.value || "";
    guest.email = document.getElementById("inv-email")?.value || "";
    guest.phone = document.getElementById("inv-phone")?.value || "";
    date = document.getElementById("inv-date")?.value || date;
  }

  function render() {
    let body = "";
    if (errorMsg) body += `<p class="owner-license-msg err">${Html.esc(errorMsg)}</p>`;
    if (okMsg) body += `<p class="owner-license-msg ok">${Html.esc(okMsg)}</p>`;
    if (screen === "list") body += renderList();
    else if (screen === "edit") body += renderEdit();
    else if (screen === "preview") body += renderPreview();
    root.innerHTML = body;

    if (screen === "edit") {
      renderLinesBody();
      bindLineInputs();
      root.querySelectorAll('input[name="inv-guest-kind"]').forEach((r) => {
        r.onchange = () => { readGuestFromDom(); render(); };
      });
      document.getElementById("inv-guest-pick")?.addEventListener("change", (e) => applyGuestPick(e.target.value));
      document.getElementById("inv-preset")?.addEventListener("change", (e) => {
        const v = e.target.value;
        if (v) lines.push({ ...emptyLine(), description: v });
        e.target.value = "";
        render();
      });
      document.getElementById("inv-add-line")?.addEventListener("click", () => { lines.push(emptyLine()); render(); });
      document.getElementById("inv-go-preview")?.addEventListener("click", () => { readGuestFromDom(); goPreview(); });
      document.getElementById("inv-back-list")?.addEventListener("click", () => { screen = "list"; render(); });
    }

    if (screen === "list") {
      document.getElementById("inv-new")?.addEventListener("click", openNew);
      document.getElementById("inv-q")?.addEventListener("input", (e) => { q = e.target.value; render(); });
      document.getElementById("inv-status-filter")?.addEventListener("change", (e) => {
        statusFilter = e.target.value;
        render();
      });
      document.getElementById("inv-save-vat")?.addEventListener("click", () => saveVatSettings().catch((e) => {
        errorMsg = e.message;
        render();
      }));
      document.getElementById("inv-logo-file")?.addEventListener("change", (e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        uploadLogo(f).catch((err) => { errorMsg = err.message; render(); });
      });
      root.querySelectorAll(".inv-view").forEach((btn) => {
        btn.onclick = () => {
          const inv = store.invoices.find((i) => i.id === btn.dataset.id);
          if (inv) { previewDoc = inv; screen = "preview"; render(); }
        };
      });
      root.querySelectorAll(".inv-edit").forEach((btn) => {
        btn.onclick = () => {
          const inv = store.invoices.find((i) => i.id === btn.dataset.id);
          if (inv) openEdit(inv);
        };
      });
      root.querySelectorAll(".inv-del").forEach((btn) => {
        btn.onclick = () => {
          if (!confirm("Fshi faturën?")) return;
          store.invoices = store.invoices.filter((i) => i.id !== btn.dataset.id);
          saveStore();
          render();
        };
      });
    }

    if (screen === "preview") {
      const frame = root.querySelector(".inv-preview-frame");
      if (frame && previewDoc) frame.srcdoc = Html.buildInvoiceHtml(previewDoc);
      document.getElementById("inv-back-edit")?.addEventListener("click", () => {
        screen = editId ? "edit" : "list";
        render();
      });
      document.getElementById("inv-print")?.addEventListener("click", () => {
        if (!Html.openPrintWindow(previewDoc)) {
          errorMsg = "Lejoni popup për printim.";
          render();
          return;
        }
        const u = { ...previewDoc, status: "printed" };
        upsertInvoice(u);
        previewDoc = u;
      });
      document.getElementById("inv-email")?.addEventListener("click", sendEmail);
    }
  }

  async function initOwnerSalesInvoices() {
    if (!token) return;
    try {
      await loadSettings();
      store = loadStore();
      if (store.clientId && store.clientId !== clientId) {
        store = { clientId, guests: [], invoices: [] };
        saveStore();
      } else {
        store.clientId = clientId;
      }
      screen = "list";
      errorMsg = "";
      okMsg = "";
      render();
    } catch (e) {
      root.innerHTML = `<p class="owner-license-msg err">${Html.esc(e.message || "Nuk u ngarkua moduli Faturat.")}</p>`;
    }
  }

  window.initOwnerSalesInvoices = initOwnerSalesInvoices;
})();
