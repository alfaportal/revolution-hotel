/**
 * Modal Faturë A4 — pas mbylljes së shitjes (waiter / recepsion).
 */
(function () {
  const API = "/api/waiter/sales-invoices";
  const Html = window.SalesInvoiceHtml;
  if (!Html) return;

  let overlay = null;

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

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "w-sales-inv-overlay";
    overlay.className = "waiter-modal-backdrop";
    overlay.style.cssText = "z-index:12000;display:none;align-items:center;justify-content:center;padding:1rem";
    overlay.innerHTML = `
      <div class="waiter-modal" role="dialog" aria-label="Faturë A4" style="max-width:720px;width:100%;max-height:92vh;overflow:auto">
        <div class="waiter-modal-head">
          <strong>Faturë A4</strong>
          <button type="button" class="btn btn-ghost btn-sm" id="w-sinv-close">×</button>
        </div>
        <div id="w-sinv-body" style="padding:0.75rem 1rem 1rem"></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });
    overlay.querySelector("#w-sinv-close")?.addEventListener("click", closeModal);
    return overlay;
  }

  function closeModal() {
    if (overlay) overlay.style.display = "none";
  }

  async function wApi(path, opts) {
    return api(`${API}${path}`, opts);
  }

  async function openWaiterSalesInvoiceModal(ctx) {
    ensureOverlay();
    const body = overlay.querySelector("#w-sinv-body");
    body.innerHTML = "<p>Duke ngarkuar…</p>";
    overlay.style.display = "flex";

    let guest = emptyGuest();
    let lines = [];
    let date = new Date().toISOString().slice(0, 10);
    let seller = {};
    let settings = { vatEnabled: false, vatPercent: 18 };
    let invoiceNumber = "";
    let previewDoc = null;
    let orderId = ctx?.order_id || ctx?.orderId || null;

    try {
      const pre = await wApi("/prefill", {
        method: "POST",
        body: JSON.stringify({
          order_id: orderId,
          items: ctx?.items || ctx?.sale_items,
        }),
      });
      lines = (pre.lines || []).map((ln) => ({
        description: ln.description,
        qty: ln.qty,
        unitPrice: ln.unitPrice,
        discount: ln.discount || { type: "amount", value: 0 },
      }));
      date = pre.date || date;
      seller = pre.seller || {};
      settings = pre.settings || settings;
      orderId = pre.orderId || orderId;
    } catch (e) {
      body.innerHTML = `<p style="color:#f87171">${Html.esc(e.message || "Prefill dështoi.")}</p>`;
      return;
    }

    function escAttr(s) {
      return String(s ?? "").replace(/"/g, "&quot;");
    }

    function renderForm() {
      const b2b = guest.kind === "company";
      body.innerHTML = `
        <p class="waiter-modal-sub">Artikujt u plotësuan nga shitja e mbyllur. Plotësoni mysafirin/klientin.</p>
        <div style="margin:0.5rem 0">
          <label><input type="radio" name="w-sinv-kind" value="individual" ${!b2b ? "checked" : ""} /> Mysafir</label>
          <label style="margin-left:0.75rem"><input type="radio" name="w-sinv-kind" value="company" ${b2b ? "checked" : ""} /> B2B</label>
        </div>
        ${b2b
          ? `<label>Kompania</label><input id="w-sinv-company" class="waiter-input" value="${escAttr(guest.companyName)}" />
             <label>Kontakt</label><input id="w-sinv-name" class="waiter-input" value="${escAttr(guest.name)}" />`
          : `<label>Emri</label><input id="w-sinv-name" class="waiter-input" value="${escAttr(guest.name)}" />`}
        <label>Email</label><input type="email" id="w-sinv-email" class="waiter-input" value="${escAttr(guest.email)}" />
        <label>Adresa</label><input id="w-sinv-address" class="waiter-input" value="${escAttr(guest.address)}" />
        <label>NUI / NF</label>
        <div style="display:flex;gap:0.5rem">
          <input id="w-sinv-nui" class="waiter-input" placeholder="NUI" value="${escAttr(guest.nui)}" />
          <input id="w-sinv-nf" class="waiter-input" placeholder="NF" value="${escAttr(guest.fiscalNumber)}" />
        </div>
        <p class="waiter-modal-sub" style="margin-top:0.75rem">${lines.length} artikuj · TVSH ${settings.vatEnabled ? settings.vatPercent + "%" : "OFF"}</p>
        <div style="display:flex;gap:0.5rem;margin-top:0.75rem;flex-wrap:wrap">
          <button type="button" class="btn btn-primary" id="w-sinv-preview">Preview A4</button>
          <button type="button" class="btn btn-ghost" id="w-sinv-skip">Mbyll</button>
        </div>
        <div id="w-sinv-preview-box" style="margin-top:0.75rem;display:none">
          <iframe id="w-sinv-frame" title="Preview" sandbox="allow-same-origin" style="width:100%;min-height:360px;border:1px solid #334155;background:#fff"></iframe>
          <div style="display:flex;gap:0.5rem;margin-top:0.5rem">
            <button type="button" class="btn btn-ghost" id="w-sinv-print">Printo</button>
            <button type="button" class="btn btn-primary" id="w-sinv-email">Dërgo Email</button>
          </div>
        </div>
        <p id="w-sinv-msg" style="margin-top:0.5rem;color:#f87171"></p>`;

      body.querySelectorAll('input[name="w-sinv-kind"]').forEach((r) => {
        r.onchange = () => {
          guest.kind = r.value;
          renderForm();
        };
      });
      body.querySelector("#w-sinv-skip")?.addEventListener("click", closeModal);
      body.querySelector("#w-sinv-preview")?.addEventListener("click", onPreview);
      body.querySelector("#w-sinv-print")?.addEventListener("click", () => {
        if (previewDoc) Html.openPrintWindow(previewDoc);
      });
      body.querySelector("#w-sinv-email")?.addEventListener("click", onEmail);
    }

    function readGuest() {
      guest.kind = body.querySelector('input[name="w-sinv-kind"]:checked')?.value || "individual";
      guest.name = body.querySelector("#w-sinv-name")?.value || "";
      guest.companyName = body.querySelector("#w-sinv-company")?.value || "";
      guest.email = body.querySelector("#w-sinv-email")?.value || "";
      guest.address = body.querySelector("#w-sinv-address")?.value || "";
      guest.nui = body.querySelector("#w-sinv-nui")?.value || "";
      guest.fiscalNumber = body.querySelector("#w-sinv-nf")?.value || "";
    }

    async function onPreview() {
      const msg = body.querySelector("#w-sinv-msg");
      if (msg) msg.textContent = "";
      readGuest();
      const okName = guest.kind === "company" ? guest.companyName.trim() : guest.name.trim();
      if (!okName) {
        if (msg) msg.textContent = "Vendosni emrin.";
        return;
      }
      try {
        if (!invoiceNumber) {
          const num = await wApi("/next-number", { method: "POST", body: "{}" });
          invoiceNumber = num.number;
        }
        const vat = {
          enabled: !!settings.vatEnabled,
          percent: Number(settings.vatPercent) || 18,
        };
        const normLines = lines.map((ln) => ({
          ...ln,
          qty: Number(ln.qty) || 0,
          unitPrice: Number(ln.unitPrice) || 0,
          lineTotal: Html.lineTotal(ln),
        }));
        const totals = Html.computeTotals(normLines, vat);
        previewDoc = {
          number: invoiceNumber,
          date,
          status: "final",
          guest: { ...guest },
          lines: normLines,
          vat,
          totals,
          sellerSnapshot: seller,
          orderId,
        };
        const box = body.querySelector("#w-sinv-preview-box");
        const frame = body.querySelector("#w-sinv-frame");
        if (box) box.style.display = "block";
        if (frame) frame.srcdoc = Html.buildInvoiceHtml(previewDoc);
      } catch (e) {
        if (msg) msg.textContent = e.message || "Gabim numri.";
      }
    }

    async function onEmail() {
      const msg = body.querySelector("#w-sinv-msg");
      if (!previewDoc) {
        await onPreview();
        if (!previewDoc) return;
      }
      const to = String(previewDoc.guest?.email || "").trim();
      if (!to) {
        if (msg) msg.textContent = "Vendosni email-in.";
        return;
      }
      try {
        await wApi("/send-email", {
          method: "POST",
          body: JSON.stringify({ invoice: previewDoc, to }),
        });
        if (msg) {
          msg.style.color = "#86efac";
          msg.textContent = `Email u dërgua te ${to}.`;
        }
      } catch (e) {
        if (msg) {
          const m = String(e?.message || "");
          msg.style.color = "#f87171";
          msg.textContent =
            m === "Nuk mund të dërgohet email." || /RESEND|Resend|resend\.com/i.test(m)
              ? "Nuk mund të dërgohet email."
              : m || "Nuk mund të dërgohet email.";
        }
      }
    }

    renderForm();
  }

  window.openWaiterSalesInvoiceModal = openWaiterSalesInvoiceModal;
})();
