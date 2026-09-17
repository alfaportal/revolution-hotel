const PDFDocument = require("pdfkit");

function money(n, cur) {
  const v = (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
  return `${v} ${cur || "€"}`;
}

function invoiceGuest(invoice) {
  return invoice?.guest || invoice?.buyer || {};
}

function guestDisplayName(guest) {
  if (!guest) return "—";
  if (guest.kind === "company") {
    return String(guest.companyName || guest.name || "—").trim();
  }
  return String(guest.name || "—").trim();
}

function guestSectionHeading(guest) {
  if (guest?.kind === "company") return "Klienti (B2B)";
  return "Mysafiri";
}

function renderInvoicePdf(invoice) {
  return new Promise((resolve, reject) => {
    try {
      const seller = invoice.sellerSnapshot || {};
      const guest = invoiceGuest(invoice);
      const lines = invoice.lines || [];
      const totals = invoice.totals || {};
      const vat = invoice.vat || {};
      const cur = seller.currency || "€";

      const doc = new PDFDocument({ size: "A4", margin: 40 });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const titleName = String(seller.companyNameDisplay || seller.companyName || "").toUpperCase();
      doc.fontSize(14).font("Helvetica-Bold").text(titleName, { align: "right" });
      doc.fontSize(9).font("Helvetica");
      if (seller.nui) doc.text(`NUI: ${seller.nui}`, { align: "right" });
      if (seller.fiscalNumber) doc.text(`NF: ${seller.fiscalNumber}`, { align: "right" });
      const addr = [seller.address, seller.city].filter(Boolean).join(", ");
      if (addr) doc.text(addr, { align: "right" });
      if (seller.phone) doc.text(`Tel: ${seller.phone}`, { align: "right" });
      if (seller.email) doc.text(seller.email, { align: "right" });

      doc.moveDown(1);
      doc.fontSize(12).font("Helvetica-Bold").text(`Faturë Shitje nr. ${invoice.number || ""}`);
      doc.fontSize(10).font("Helvetica").text(`Data: ${invoice.date || ""}`);
      doc.moveDown(0.5);
      doc.font("Helvetica-Bold").text(guestSectionHeading(guest));
      doc.font("Helvetica").text(guestDisplayName(guest));
      if (guest.kind === "company" && guest.name && guest.companyName) {
        doc.text(`Kontakt: ${guest.name}`);
      }
      if (guest.address) doc.text(guest.address);
      if (guest.nui) doc.text(`NUI: ${guest.nui}`);
      if (guest.fiscalNumber) doc.text(`NF: ${guest.fiscalNumber}`);
      if (guest.phone) doc.text(`Tel: ${guest.phone}`);
      if (guest.email) doc.text(guest.email);

      doc.moveDown(1);
      const startY = doc.y;
      const col = [40, 70, 280, 330, 390, 450];
      doc.fontSize(8).font("Helvetica-Bold");
      doc.text("Nr", col[0], startY);
      doc.text("Përshkrimi", col[1], startY);
      doc.text("Sasia", col[2], startY, { width: 45, align: "right" });
      doc.text("Çmimi", col[3], startY, { width: 55, align: "right" });
      doc.text("Zbritja", col[4], startY, { width: 55, align: "right" });
      doc.text("Totali", col[5], startY, { width: 90, align: "right" });
      doc.moveTo(40, startY + 14).lineTo(555, startY + 14).stroke();

      let y = startY + 18;
      doc.font("Helvetica").fontSize(8);
      lines.forEach((ln, i) => {
        const disc = ln.discount?.value
          ? (ln.discount.type === "percent" ? `${ln.discount.value}%` : money(ln.discount.value, cur))
          : "—";
        doc.text(String(i + 1), col[0], y);
        doc.text(String(ln.description || "").slice(0, 48), col[1], y, { width: 200 });
        doc.text(String(ln.qty ?? ""), col[2], y, { width: 45, align: "right" });
        doc.text(money(ln.unitPrice, cur), col[3], y, { width: 55, align: "right" });
        doc.text(disc, col[4], y, { width: 55, align: "right" });
        doc.text(money(ln.lineTotal, cur), col[5], y, { width: 90, align: "right" });
        y += 16;
        if (y > 700) {
          doc.addPage();
          y = 50;
        }
      });

      y += 10;
      doc.font("Helvetica-Bold");
      doc.text("Nëntotali:", 380, y, { width: 70, align: "right" });
      doc.text(money(totals.subtotal, cur), col[5], y, { width: 90, align: "right" });
      y += 14;
      if (vat.enabled) {
        doc.text(`TVSH (${Number(vat.percent) || 0}%):`, 380, y, { width: 70, align: "right" });
        doc.text(money(totals.vatAmount, cur), col[5], y, { width: 90, align: "right" });
        y += 14;
      }
      doc.fontSize(10).text("Totali i përgjithshëm:", 340, y, { width: 110, align: "right" });
      doc.text(money(totals.grandTotal, cur), col[5], y, { width: 90, align: "right" });

      y += 40;
      doc.fontSize(8).font("Helvetica");
      doc.text("Nënshkrimi", 40, y);
      doc.text("Vula", 300, y);
      doc.moveTo(40, y + 30).lineTo(250, y + 30).stroke();
      doc.moveTo(300, y + 30).lineTo(510, y + 30).stroke();

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { renderInvoicePdf };
