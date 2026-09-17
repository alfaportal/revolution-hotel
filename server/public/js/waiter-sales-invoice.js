/**
 * Faturë A4 pas mbylljes së tavolinës — waiter / recepsion.
 */
(function (global) {
  const Html = () => global.OwnerSalesInvoiceHtml;

  let slug = "";
  let apiFn = null;
  let apiQueryFn = null;
  let waiterPayloadFn = null;
  let getLastClosedSale = null;
  let getLastClosedItems = null;
  let $ = null;

  let prefill = null;
  let guest = emptyGuest();
  let previewDoc = null;
  let invoiceNumber = "";
  let busy = false;

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

  function invApi(path, opts = {}) {
    const base = `/api/waiter/${encodeURIComponent(slug)}${path}${apiQueryFn()}`;
    return apiFn(base, opts);
  }

  function escAttr(s) {
    return String(s ?? "").replace(/"/g, "&quot;");
  }

  function showErr(msg) {
    const el = $("invoice-a4-err");
    if (!el) return;
    if (!msg) {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    el.textContent = msg;
    el.classList.remove("hidden");
  }

  function setStep(step) {
    $("invoice-a4-step-guest")?.classList.toggle("hidden", step !== "guest");
    $("invoice-a4-step-preview")?.classList.toggle("hidden", step !== "preview");
  }

  function readGuestFromDom() {
    const kind = document.querySelector('input[name="inv-a4-guest-kind"]:checked')?.value || "individual";
    guest.kind = kind;
    guest.name = $("inv-a4-name")?.value || "";
    guest.companyName = $("inv-a4-company")?.value || "";
    guest.address = $("inv-a4-address")?.value || "";
    guest.nui = $("inv-a4-nui")?.value || "";
    guest.fiscalNumber = $("inv-a4-nf")?.value || "";
    guest.email = $("inv-a4-email")?.value || "";
    guest.phone = $("inv-a4-phone")?.value || "";
  }

  function renderGuestForm() {
    const root = $("invoice-a4-guest-fields");
    if (!root) return;
    const b2b = guest.kind === "company";
    root.innerHTML = `
      <div class="invoice-a4-kind-row">
        <label><input type="radio" name="inv-a4-guest-kind" value="individual" ${!b2b ? "checked" : ""} /> Mysafir</label>
        <label><input type="radio" name="inv-a4-guest-kind" value="company" ${b2b ? "checked" : ""} /> Klient (B2B)</label>
      </div>
      ${b2b
    ? `<label class="invoice-a4-field">Emri i kompanisë<input id="inv-a4-company" value="${escAttr(guest.companyName)}" /></label>
         <label class="invoice-a4-field">Kontakt / emri<input id="inv-a4-name" value="${escAttr(guest.name)}" /></label>`
    : `<label class="invoice-a4-field">Emri<input id="inv-a4-name" value="${escAttr(guest.name)}" /></label>`}
      <label class="invoice-a4-field">Adresa<input id="inv-a4-address" value="${escAttr(guest.address)}" /></label>
      <label class="invoice-a4-field">NUI<input id="inv-a4-nui" value="${escAttr(guest.nui)}" /></label>
      <label class="invoice-a4-field">NF<input id="inv-a4-nf" value="${escAttr(guest.fiscalNumber)}" /></label>
      <label class="invoice-a4-field">Email<input type="email" id="inv-a4-email" value="${escAttr(guest.email)}" /></label>
      <label class="invoice-a4-field">Telefoni<input id="inv-a4-phone" value="${escAttr(guest.phone)}" /></label>
    `;
    root.querySelectorAll('input[name="inv-a4-guest-kind"]').forEach((r) => {
      r.onchange = () => {
        readGuestFromDom();
        renderGuestForm();
      };
    });
  }

  function buildPreviewDoc(num) {
    const H = Html();
    if (!H || !prefill) return null;
    const vat = {
      enabled: !!prefill.settings?.vatEnabled,
      percent: Number(prefill.settings?.vatPercent) || 18,
    };
    const normLines = (prefill.lines || []).map((ln) => ({
      ...ln,
      qty: Number(ln.qty) || 0,
      unitPrice: Number(ln.unitPrice) || 0,
      lineTotal: H.lineTotal(ln),
    }));
    const totals = H.computeTotals(normLines, vat);
    return {
      id: `w-inv-${Date.now()}`,
      number: num,
      date: prefill.date || new Date().toISOString().slice(0, 10),
      status: "final",
      guest: { ...guest },
      lines: normLines,
      vat,
      totals,
      sellerSnapshot: { ...(prefill.seller || {}) },
    };
  }

  async function goPreview() {
    readGuestFromDom();
    const nameOk = guest.kind === "company"
      ? String(guest.companyName || "").trim()
      : String(guest.name || "").trim();
    if (!nameOk) {
      showErr(guest.kind === "company"
        ? "Vendosni emrin e kompanisë (klient B2B)."
        : "Vendosni emrin e mysafirit.");
      return;
    }
    if (!prefill?.lines?.length) {
      showErr("Nuk ka artikuj për faturën.");
      return;
    }
    if (!navigator.onLine) {
      showErr("Pa internet nuk alokohet numri. Lidhu online.");
      return;
    }
    busy = true;
    showErr("");
    $("invoice-a4-go-preview") && ($("invoice-a4-go-preview").disabled = true);
    try {
      if (!invoiceNumber) {
        const data = await invApi("/sales-invoices/next-number", {
          method: "POST",
          body: JSON.stringify({ ...waiterPayloadFn() }),
        });
        invoiceNumber = data.number;
      }
      previewDoc = buildPreviewDoc(invoiceNumber);
      if (!previewDoc) throw new Error("Preview nuk u krijua.");
      const frame = $("invoice-a4-preview-frame");
      if (frame) frame.srcdoc = Html().buildInvoiceHtml(previewDoc);
      const em = String(guest.email || "").trim();
      const hint = $("invoice-a4-email-hint");
      if (hint) {
        hint.textContent = em ? `PDF → ${em}` : "⚠ Mungon email i mysafirit/klientit";
      }
      const emailBtn = $("invoice-a4-email");
      if (emailBtn) emailBtn.disabled = !em;
      setStep("preview");
    } catch (e) {
      showErr(e.message || "Numri nuk u alokua.");
    } finally {
      busy = false;
      if ($("invoice-a4-go-preview")) $("invoice-a4-go-preview").disabled = false;
    }
  }

  async function sendEmail() {
    if (!previewDoc) return;
    const to = String(guest.email || "").trim();
    if (!to) {
      showErr("Vendosni email-in e mysafirit/klientit.");
      setStep("guest");
      return;
    }
    busy = true;
    showErr("");
    if ($("invoice-a4-email")) $("invoice-a4-email").disabled = true;
    try {
      await invApi("/sales-invoices/send-email", {
        method: "POST",
        body: JSON.stringify({
          ...waiterPayloadFn(),
          invoice: previewDoc,
          to,
        }),
      });
      showErr("");
      alert(`Email u dërgua te ${to}. Kontrollo Spam.`);
    } catch (e) {
      showErr(e.message || "Dërgimi dështoi.");
    } finally {
      busy = false;
      if ($("invoice-a4-email")) $("invoice-a4-email").disabled = !to;
    }
  }

  function openModal() {
    const sale = getLastClosedSale?.();
    if (!sale?.id) {
      alert("Nuk ka shitje të mbyllur për faturë A4.");
      return;
    }
    if (!Html()) {
      alert("Moduli i faturës A4 nuk u ngarkua.");
      return;
    }
    guest = emptyGuest();
    prefill = null;
    previewDoc = null;
    invoiceNumber = "";
    showErr("");
    setStep("guest");
    renderGuestForm();
    $("invoice-a4-modal")?.classList.remove("hidden");
    $("invoice-a4-lines-summary") && ($("invoice-a4-lines-summary").textContent = "Duke ngarkuar artikujt…");

    invApi("/sales-invoices/prefill", {
      method: "POST",
      body: JSON.stringify({
        ...waiterPayloadFn(),
        sale_order_id: sale.id,
        items: getLastClosedItems?.() || undefined,
      }),
    }).then((data) => {
      prefill = data;
      const n = (data.lines || []).length;
      const total = Number(data.sale?.total) || 0;
      const summary = $("invoice-a4-lines-summary");
      if (summary) {
        summary.textContent = n
          ? `${n} artikuj · ${total.toFixed(2)} € (neto sipas shitjes)`
          : "Pa artikuj";
      }
    }).catch((e) => {
      showErr(e.message || "Prefill dështoi.");
      $("invoice-a4-lines-summary") && ($("invoice-a4-lines-summary").textContent = "—");
    });
  }

  function closeModal() {
    $("invoice-a4-modal")?.classList.add("hidden");
  }

  function bindUi() {
    $("btn-invoice-a4")?.addEventListener("click", () => {
      try {
        openModal();
      } catch (e) {
        alert(e.message || "Hapja dështoi.");
      }
    });
    $("invoice-a4-backdrop")?.addEventListener("click", closeModal);
    $("invoice-a4-close")?.addEventListener("click", closeModal);
    $("invoice-a4-back-guest")?.addEventListener("click", () => {
      setStep("guest");
      renderGuestForm();
    });
    $("invoice-a4-go-preview")?.addEventListener("click", () => goPreview());
    $("invoice-a4-print")?.addEventListener("click", () => {
      if (!previewDoc || !Html()) return;
      if (!Html().openPrintWindow(previewDoc)) {
        showErr("Lejoni popup për printim.");
      }
    });
    $("invoice-a4-email")?.addEventListener("click", () => sendEmail());
  }

  function init(deps) {
    slug = deps.slug || "";
    apiFn = deps.api;
    apiQueryFn = deps.apiQuery;
    waiterPayloadFn = deps.waiterPayload;
    getLastClosedSale = deps.getLastClosedSale;
    getLastClosedItems = deps.getLastClosedItems;
    $ = deps.$;
    bindUi();
  }

  global.WaiterSalesInvoice = { init, openModal, closeModal };
})(typeof window !== "undefined" ? window : global);
