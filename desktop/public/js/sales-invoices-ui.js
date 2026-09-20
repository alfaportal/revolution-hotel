/**
 * Faturat A4 shitje — admin desktop (SQLite lokale).
 */
(function () {
  const API = "/api/admin/sales-invoices";
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

  const root = document.getElementById("admin-sales-invoices-root");
  const Html = window.SalesInvoiceHtml;
  if (!root || !Html) return;

  let settings = { vatEnabled: false, vatPercent: 18, companyLogoUrl: "" };
  let seller = {};
  let invoices = [];
  let screen = "list";
  let busy = false;
  let errorMsg = "";
  let okMsg = "";
  let previewDoc = null;
  let invoiceNumber = "";
  let editId = null;
  let guest = emptyGuest();
  let lines = [emptyLine()];
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

  function emptyLine() {
    return { description: "", qty: 1, unitPrice: "", discount: { type: "amount", value: 0 } };
  }

  function euro(n) {
    return `${(Number(n) || 0).toFixed(2)} €`;
  }

  function escAttr(s) {
    return String(s ?? "").replace(/"/g, "&quot;");
  }

  async function invApi(path, opts = {}) {
    return api(`${API}${path}`, opts);
  }

  function vatFromSettings() {
    return { enabled: !!settings.vatEnabled, percent: Number(settings.vatPercent) || 18 };
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

  function renderSettingsCard() {
    return `
    <div class="card inv-settings-card">
      <div class="card-title">Fatura A4 — cilësimet</div>
      <p class="purchases-panel-sub">Shitësi: emri, NUI, NF, adresa nga Admin → Fiskalizimi / lokal.</p>
      <div class="link-row inv-logo-row" style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap">
        <label>Logo</label>
        ${settings.companyLogoUrl ? `<img src="${escAttr(settings.companyLogoUrl)}" alt="" style="max-height:48px" />` : "<span class=\"purchases-panel-sub\">Pa logo</span>"}
        <input type="file" accept="image/*" id="inv-logo-file" ${busy ? "disabled" : ""} />
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
    <div class="card" style="margin-top:0.75rem">
      <div class="card-title">Artikuj (çmimet neto)</div>
      <div class="form-row">
        <label>Shto shpejt:</label>
        <select id="inv-preset"><option value="">—</option>${PRESETS.map((p) => `<option value="${escAttr(p)}">${Html.esc(p)}</option>`).join("")}</select>
      </div>
      <table class="dashboard-top-table">
        <thead><tr><th>Përshkrimi</th><th>Sasia</th><th>Çmimi neto</th><th>Zbritja €</th><th></th></tr></thead>
        <tbody id="inv-lines-body"></tbody>
      </table>
      <button type="button" class="btn btn-ghost btn-sm" id="inv-add-line">+ Rresht</button>
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

  async function goPreview() {
    errorMsg = "";
    readGuestFromDom();
    const nameOk = guest.kind === "company" ? guest.companyName.trim() : guest.name.trim();
    if (!nameOk) {
      errorMsg = guest.kind === "company" ? "Vendosni emrin e kompanisë." : "Vendosni emrin e mysafirit.";
      render();
      return;
    }
    if (!lines.some((ln) => String(ln.description || "").trim())) {
      errorMsg = "Shtoni të paktën një artikull.";
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
    lines = [emptyLine()];
    date = todayYmd();
    errorMsg = "";
    okMsg = "";
    render();
  }

  function openView(inv) {
    previewDoc = {
      ...inv,
      sellerSnapshot: inv.sellerSnapshot || seller,
    };
    screen = "preview";
    render();
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
      renderLinesBody();
      bindLineInputs();
      root.querySelectorAll('input[name="inv-guest-kind"]').forEach((r) => {
        r.onchange = () => { readGuestFromDom(); render(); };
      });
      document.getElementById("inv-preset")?.addEventListener("change", (e) => {
        const v = e.target.value;
        if (v) lines.push({ ...emptyLine(), description: v });
        e.target.value = "";
        render();
      });
      document.getElementById("inv-add-line")?.addEventListener("click", () => { lines.push(emptyLine()); render(); });
      document.getElementById("inv-go-preview")?.addEventListener("click", goPreview);
      document.getElementById("inv-back-list")?.addEventListener("click", () => { screen = "list"; loadAll().then(render); });
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
          lines = previewDoc.lines.map((ln) => ({
            description: ln.description,
            qty: ln.qty,
            unitPrice: ln.unitPrice,
            discount: ln.discount || { type: "amount", value: 0 },
          }));
          date = previewDoc.date;
          invoiceNumber = previewDoc.number;
        }
        render();
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
