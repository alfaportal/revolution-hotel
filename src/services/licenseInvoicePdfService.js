/**
 * Faturë PDF për pagesë licence (bankë / Stripe) — me datë, vulë dhe nënshkrim.
 * Pa varësi të jashtme. Shkronjat speciale → ASCII për Helvetica.
 */

const { getBankTransferPublic } = require("../lib/bankTransferConfig");

function pdfEscape(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function asciiPdf(text) {
  return String(text || "")
    .replace(/ë/g, "e")
    .replace(/Ë/g, "E")
    .replace(/ç/g, "c")
    .replace(/Ç/g, "C")
    .replace(/[^\x20-\x7E]/g, "?");
}

function money(n) {
  return `${Number(n || 0).toFixed(2)} EUR`;
}

/**
 * @param {{
 *   invoiceNo: string,
 *   invoiceDate: string,
 *   businessName: string,
 *   ownerName: string,
 *   email: string,
 *   planLabel: string,
 *   amountEur: number,
 *   paymentMethod: string,
 *   licenseKey?: string|null,
 * }} opts
 */
function buildLicenseInvoicePdf(opts) {
  const seller = getBankTransferPublic();
  const date = opts.invoiceDate || new Date().toISOString().slice(0, 10);
  const lines = [
    "REVOLUTION INVEST SH.P.K.",
    "FATURE TATIMORE / FATURA E RREGULLT",
    `Nr. fatures: ${opts.invoiceNo || "—"}`,
    `Data: ${date}`,
    "",
    "SHITESI:",
    `  ${seller.company}`,
    `  NUI: ${seller.nui}`,
    `  Banka: ${seller.bank}`,
    `  Llogaria: ${seller.account} ${seller.currency}`,
    "",
    "BLERESI:",
    `  Biznesi: ${opts.businessName || "—"}`,
    `  Personi: ${opts.ownerName || "—"}`,
    `  Email: ${opts.email || "—"}`,
    "",
    "PERSHKRIMI:",
    `  ${opts.planLabel || "Licenca Revolution POS (1 vit)"}`,
    `  Menyra e pageses: ${opts.paymentMethod || "Transfer bankar"}`,
    "",
    `TOTALI PER PAGESË: ${money(opts.amountEur)}`,
    "",
    "Pagesa eshte konfirmuar. Kjo fature lëshohet vetem pas konfirmimit te pageses.",
    opts.licenseKey ? `Celësi i licences: ${opts.licenseKey}` : "",
    "",
    "------------------------------------------------",
    "NENSHKRIMI / VULA E KOMPANISE",
    `Data e leshimit: ${date}`,
    seller.company,
    "Vulosur & nenshkruar elektronikisht",
    "------------------------------------------------",
  ].filter((l) => l !== undefined);

  const contentOps = [];
  let y = 800;
  for (const line of lines) {
    const text = asciiPdf(line);
    const size = line.startsWith("FATURE") || line.startsWith("REVOLUTION") ? 13 : 11;
    contentOps.push(`BT /F1 ${size} Tf 50 ${y} Td (${pdfEscape(text)}) Tj ET`);
    y -= line === "" ? 10 : 16;
  }

  // Vulë rrethore (vizatim)
  const cx = 460;
  const cy = 160;
  const r = 55;
  contentOps.push("q");
  contentOps.push("0.75 0.1 0.15 RG");
  contentOps.push("1.5 w");
  contentOps.push(`${cx} ${cy} ${r} 0 360 arc`);
  contentOps.push("S");
  contentOps.push(`${cx} ${cy} ${r - 6} 0 360 arc`);
  contentOps.push("S");
  contentOps.push("Q");
  contentOps.push(
    `BT /F1 8 Tf ${cx - 42} ${cy + 8} Td (${pdfEscape(asciiPdf("REVOLUTION INVEST"))}) Tj ET`,
  );
  contentOps.push(
    `BT /F1 7 Tf ${cx - 28} ${cy - 6} Td (${pdfEscape(asciiPdf("SH.P.K. — VULA"))}) Tj ET`,
  );
  contentOps.push(
    `BT /F1 7 Tf ${cx - 22} ${cy - 18} Td (${pdfEscape(date)}) Tj ET`,
  );

  // PDF "arc" nuk është standard në PDF 1.4 pa ext — përdor Bézier circle
  const stream = contentOps
    .join("\n")
    .replace(
      /(\d+(?:\.\d+)?) (\d+(?:\.\d+)?) (\d+(?:\.\d+)?) 0 360 arc/g,
      (_, x, yc, rad) => bezierCircle(Number(x), Number(yc), Number(rad)),
    );

  return assemblePdf(stream);
}

function bezierCircle(cx, cy, r) {
  const k = 0.5522847498 * r;
  return [
    `${cx + r} ${cy} m`,
    `${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r} c`,
    `${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy} c`,
    `${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r} c`,
    `${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy} c`,
  ].join("\n");
}

function assemblePdf(stream) {
  const objects = [];
  objects.push("1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n");
  objects.push("2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n");
  objects.push(
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n",
  );
  objects.push(
    `4 0 obj<< /Length ${Buffer.byteLength(stream, "utf8")} >>stream\n${stream}\nendstream\nendobj\n`,
  );
  objects.push("5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n");

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += obj;
  }
  const xrefPos = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
}

module.exports = {
  buildLicenseInvoicePdf,
  asciiPdf,
};
