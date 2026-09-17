/* Fatura A4 — HTML preview + print (panel pronari) */
(function (global) {
  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function roundMoney(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  function fmtMoney(n, cur) {
    const v = roundMoney(n).toFixed(2);
    return `${v} ${cur || "€"}`;
  }

  function lineDiscountAmount(base, discount) {
    if (!discount || !discount.value) return 0;
    const v = Number(discount.value) || 0;
    if (v <= 0) return 0;
    if (String(discount.type || "").toLowerCase() === "percent") {
      return roundMoney((base * v) / 100);
    }
    return roundMoney(v);
  }

  function lineTotal(line) {
    const qty = Number(line.qty) || 0;
    const price = Number(line.unitPrice) || 0;
    const base = roundMoney(qty * price);
    const disc = lineDiscountAmount(base, line.discount);
    return roundMoney(Math.max(0, base - disc));
  }

  function computeTotals(lines, vat) {
    const subtotal = roundMoney((lines || []).reduce((s, ln) => s + lineTotal(ln), 0));
    const enabled = Boolean(vat?.enabled);
    let percent = Number(vat?.percent);
    if (!Number.isFinite(percent) || percent < 0) percent = 18;
    if (!enabled) {
      return { subtotal, vatAmount: 0, grandTotal: subtotal, vatPercent: 0 };
    }
    const vatAmount = roundMoney((subtotal * percent) / 100);
    return {
      subtotal,
      vatAmount,
      grandTotal: roundMoney(subtotal + vatAmount),
      vatPercent: percent,
    };
  }

  function invoiceGuest(invoice) {
    return invoice?.guest || invoice?.buyer || {};
  }

  function guestDisplayTitle(guest) {
    if (!guest) return "—";
    if (guest.kind === "company") {
      return esc(guest.companyName || guest.name || "—");
    }
    return esc(guest.name || "—");
  }

  function guestSectionHeading(guest) {
    if (guest?.kind === "company") return "Klienti (B2B)";
    return "Mysafiri";
  }

  function defaultPrintCss() {
    return `
@page { size: A4; margin: 14mm; }
* { box-sizing: border-box; }
body { margin: 0; font: 11pt/1.35 'Segoe UI', Arial, sans-serif; color: #111; background: #fff; }
.inv-page { max-width: 180mm; margin: 0 auto; }
.inv-header { display: flex; gap: 16px; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 12px; }
.inv-logo { max-height: 56px; max-width: 120px; object-fit: contain; }
.inv-company { margin: 0 0 6px; font-size: 14pt; font-weight: 700; text-transform: uppercase; }
.inv-title { margin: 12px 0 4px; font-size: 13pt; }
.inv-date { margin: 0 0 12px; color: #333; }
.inv-guest { margin-bottom: 14px; padding: 8px 10px; border: 1px solid #ccc; }
.inv-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
.inv-table th, .inv-table td { border: 1px solid #333; padding: 6px 8px; text-align: left; }
.inv-table th { background: #f0f0f0; font-weight: 600; }
.inv-table .num { text-align: right; white-space: nowrap; }
.tot-label { text-align: right; font-weight: 600; }
.inv-grand td { font-weight: 700; font-size: 12pt; }
.inv-sign { display: flex; gap: 24px; margin-top: 28px; }
.inv-sign-box { flex: 1; border-top: 1px solid #111; padding-top: 8px; min-height: 48px; color: #444; font-size: 10pt; }
@media print {
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;
  }

  function buildInvoiceHtml(invoice) {
    const seller = invoice.sellerSnapshot || {};
    const guest = invoiceGuest(invoice);
    const lines = invoice.lines || [];
    const currency = seller.currency || "€";
    const vat = invoice.vat || {};
    const totals = invoice.totals || {};
    const addr = [seller.address, seller.city].filter(Boolean).join(", ");

    const rows = lines.map((ln, i) => {
      const disc = ln.discount?.value
        ? (ln.discount.type === "percent" ? `${ln.discount.value}%` : fmtMoney(ln.discount.value, currency))
        : "—";
      return `<tr>
        <td>${i + 1}</td>
        <td>${esc(ln.description)}</td>
        <td class="num">${esc(ln.qty)}</td>
        <td class="num">${fmtMoney(ln.unitPrice, currency)}</td>
        <td class="num">${disc}</td>
        <td class="num">${fmtMoney(ln.lineTotal, currency)}</td>
      </tr>`;
    }).join("");

    const logoBlock = seller.logoUrl
      ? `<img class="inv-logo" src="${esc(seller.logoUrl)}" alt="" />`
      : "";

    const vatLine = vat.enabled
      ? `<tr><td colspan="5" class="tot-label">TVSH (${Number(vat.percent) || 0}%)</td><td class="num">${fmtMoney(totals.vatAmount, currency)}</td></tr>`
      : "";

    const guestExtra = [];
    if (guest.kind === "company" && guest.name && guest.companyName) {
      guestExtra.push(`<div>Kontakt: ${esc(guest.name)}</div>`);
    }
    if (guest.address) guestExtra.push(`<div>${esc(guest.address)}</div>`);
    if (guest.nui) guestExtra.push(`<div>NUI: ${esc(guest.nui)}</div>`);
    if (guest.fiscalNumber) guestExtra.push(`<div>NF: ${esc(guest.fiscalNumber)}</div>`);
    if (guest.phone) guestExtra.push(`<div>Tel: ${esc(guest.phone)}</div>`);
    if (guest.email) guestExtra.push(`<div>${esc(guest.email)}</div>`);

    return `<!DOCTYPE html>
<html lang="sq"><head><meta charset="utf-8"/>
<title>Faturë ${esc(invoice.number)}</title>
<style>${defaultPrintCss()}</style></head><body>
<div class="inv-page">
  <header class="inv-header">
    <div class="inv-header-left">${logoBlock}</div>
    <div class="inv-header-right">
      <h1 class="inv-company">${esc(seller.companyNameDisplay || seller.companyName)}</h1>
      ${seller.nui ? `<div>NUI: ${esc(seller.nui)}</div>` : ""}
      ${seller.fiscalNumber ? `<div>NF: ${esc(seller.fiscalNumber)}</div>` : ""}
      ${addr ? `<div>${esc(addr)}</div>` : ""}
      ${seller.phone ? `<div>Tel: ${esc(seller.phone)}</div>` : ""}
      ${seller.email ? `<div>${esc(seller.email)}</div>` : ""}
    </div>
  </header>
  <h2 class="inv-title">Faturë Shitje nr. ${esc(invoice.number)}</h2>
  <p class="inv-date">Data: ${esc(invoice.date)}</p>
  <section class="inv-guest">
    <strong>${guestSectionHeading(guest)}</strong>
    <div>${guestDisplayTitle(guest)}</div>
    ${guestExtra.join("")}
  </section>
  <table class="inv-table">
    <thead><tr><th>Nr</th><th>Përshkrimi</th><th>Sasia</th><th>Çmimi neto</th><th>Zbritja</th><th>Totali</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr><td colspan="5" class="tot-label">Nëntotali</td><td class="num">${fmtMoney(totals.subtotal, currency)}</td></tr>
      ${vatLine}
      <tr class="inv-grand"><td colspan="5" class="tot-label">Totali i përgjithshëm</td><td class="num">${fmtMoney(totals.grandTotal, currency)}</td></tr>
    </tfoot>
  </table>
  <div class="inv-sign">
    <div class="inv-sign-box"><span>Nënshkrimi</span></div>
    <div class="inv-sign-box"><span>Vula</span></div>
  </div>
</div></body></html>`;
  }

  function openPrintWindow(invoice) {
    const html = buildInvoiceHtml(invoice);
    const w = window.open("", "_blank", "noopener,noreferrer");
    if (!w) return false;
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
    return true;
  }

  global.OwnerSalesInvoiceHtml = {
    esc,
    lineTotal,
    computeTotals,
    buildInvoiceHtml,
    openPrintWindow,
  };
})(typeof window !== "undefined" ? window : global);
