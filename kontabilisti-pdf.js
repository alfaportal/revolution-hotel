/**
 * Mbush formularët zyrtarë ATK (PDF me fusha AcroForm).
 */
const fs = require("fs");
const path = require("path");
const { PDFDocument } = require("pdf-lib");

const TEMPLATES_DIR = path.join(__dirname, "kontabilisti-templates");

const PDF_FILES = {
  vatDeclaration: "Deklarata e TVSH-se.pdf",
  withholding: "Formulari i Tatimit ne Burim.pdf",
  rentForm: "Formulari i qerase.pdf",
  quarterly: "Formulari Tremujore.pdf",
  annualCd: "Pasqyra vjetore - CD.pdf",
};

function pdfPath(key) {
  const name = PDF_FILES[key];
  if (!name) throw new Error("PDF ATK i panjohur");
  const p = path.join(TEMPLATES_DIR, name);
  if (!fs.existsSync(p)) throw new Error("Mungon PDF: " + name);
  return p;
}

function moneyStr(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0.00";
  return v.toFixed(2);
}

function f0(leaf) {
  return `form1[0].#subform[0].${leaf}`;
}
function f1(leaf) {
  return `form1[0].#subform[1].${leaf}`;
}

function setText(form, fieldName, value) {
  if (value == null || value === "") return;
  try {
    const field = form.getTextField(fieldName);
    field.setText(String(value));
  } catch {
    /* fusha mungon në version të ndryshëm */
  }
}

function setMoney(form, fieldName, value) {
  setText(form, fieldName, moneyStr(value));
}

function fillHeader(form, header = {}) {
  setText(form, f0("txtPeriod[0]"), header.period || "");
  setText(form, f0("txtBRN[0]"), header.nui || header.brn || "");
  setText(form, f0("txtName[0]"), header.bizName || header.name || "");
  setText(form, f0("txtAddress[0]"), header.address || "");
  setText(form, f0("txtContactName[0]"), header.contact || header.bizName || "");
  setText(form, f0("txtTelephone[0]"), header.phone || "");
  if (header.createDate) setText(form, f0("txtCreateDate[0]"), header.createDate);
}

async function loadPdf(key) {
  const bytes = fs.readFileSync(pdfPath(key));
  return PDFDocument.load(bytes, { ignoreEncryption: true });
}

async function savePdf(doc) {
  try {
    doc.getForm().updateFieldAppearances();
  } catch {
    /* disa fonte mungojnë — vlera mbeten në fusha */
  }
  const out = await doc.save({ updateFieldAppearances: false });
  return Buffer.from(out);
}

/** Deklarata e TVSH-së */
async function fillVatDeclarationPdf({ salesTotals, purchaseTotals, header, vatPayable }) {
  const doc = await loadPdf("vatDeclaration");
  const form = doc.getForm();
  fillHeader(form, header);
  const s = salesTotals || {};
  const p = purchaseTotals || {};

  setMoney(form, f0("L9[0]"), s.box9);
  setMoney(form, f0("L10[0]"), s.box10);
  setMoney(form, f0("L11[0]"), s.box11);
  setMoney(form, f0("L12[0]"), s.box12);
  setMoney(form, f0("L14[0]"), s.box14);
  setMoney(form, f0("L16[0]"), s.box16);
  setMoney(form, f0("L18[0]"), s.box18);
  setMoney(form, f0("L20[0]"), s.box20);
  setMoney(form, f0("L22[0]"), s.box22);
  setMoney(form, f0("L24[0]"), s.box24);
  setMoney(form, f0("L26[0]"), s.box26);
  setMoney(form, f0("L28[0]"), s.box28);
  setMoney(form, f0("L30[0]"), s.box30);

  setMoney(form, f0("L31[0]"), p.box31);
  setMoney(form, f0("L32[0]"), p.box32);
  setMoney(form, f0("L33[0]"), p.box33);
  setMoney(form, f0("L34[0]"), p.box34);
  setMoney(form, f0("L35[0]"), p.box35);
  setMoney(form, f0("L37[0]"), p.box37);
  setMoney(form, f0("L39[0]"), p.box39);
  setMoney(form, f0("L41[0]"), p.box41);
  setMoney(form, f0("L43[0]"), p.box43);
  setMoney(form, f0("L45[0]"), p.box45);
  setMoney(form, f0("L47[0]"), p.box47);
  setMoney(form, f0("L49[0]"), p.box49);
  setMoney(form, f0("L51[0]"), p.box51);
  setMoney(form, f0("L53[0]"), p.box53);
  setMoney(form, f0("L55[0]"), p.box55);
  setMoney(form, f0("L57[0]"), p.box57);
  setMoney(form, f0("L59[0]"), p.box59);
  setMoney(form, f0("L61[0]"), p.box61);
  setMoney(form, f0("L63[0]"), p.box63);
  setMoney(form, f0("L65[0]"), p.box65);
  setMoney(form, f0("L67[0]"), p.box67);

  const pay = Number(vatPayable);
  if (Number.isFinite(pay)) {
    if (pay >= 0) {
      setMoney(form, f0("L68[0]"), pay);
      setMoney(form, f0("L69[0]"), 0);
    } else {
      setMoney(form, f0("L68[0]"), 0);
      setMoney(form, f0("L69[0]"), Math.abs(pay));
    }
  }
  return savePdf(doc);
}

/** Formulari i Tatimit në Burim (paga) */
async function fillWithholdingPayrollPdf({ withholding, header }) {
  const doc = await loadPdf("withholding");
  const form = doc.getForm();
  fillHeader(form, header);
  const w = withholding || {};
  setMoney(form, f0("L8[0]"), w.box8);
  setMoney(form, f0("L9[0]"), w.box9);
  setText(form, f0("L10[0]"), String(w.box10 ?? 0));
  setText(form, f0("L11[0]"), String(w.box11 ?? 0));
  setText(form, f0("L12[0]"), String(w.box12 ?? 0));
  setText(form, f0("L13[0]"), String(w.box13 ?? 0));
  setText(form, f0("L16[0]"), String(w.box16 ?? 0));
  setMoney(form, f0("L17[0]"), w.box17);
  setMoney(form, f0("L18[0]"), w.box18);
  setMoney(form, f0("L19[0]"), w.box19);
  setMoney(form, f0("L20[0]"), w.box20);
  setMoney(form, f0("L22[0]"), w.box22);
  setMoney(form, f0("L23[0]"), w.box23);
  return savePdf(doc);
}

/** Formulari i qerase */
async function fillRentFormPdf({ form: rentForm, header }) {
  const doc = await loadPdf("rentForm");
  const form = doc.getForm();
  fillHeader(form, header);
  const f = rentForm || {};
  setMoney(form, f0("L8[0]"), f.box8);
  setMoney(form, f0("L9[0]"), f.box9);
  setMoney(form, f0("L10[0]"), f.box10);
  setMoney(form, f0("L11[0]"), 0);
  setMoney(form, f0("L12[0]"), f.box12);
  setMoney(form, f0("L13[0]"), f.box13);
  setMoney(form, f0("L14[0]"), f.box14);
  setMoney(form, f0("L15[0]"), f.box15);
  setMoney(form, f0("L16[0]"), f.box16);
  setMoney(form, f0("L17[0]"), f.box17);
  setMoney(form, f0("L18[0]"), f.box18);
  return savePdf(doc);
}

/** Formulari tremujor */
async function fillQuarterlyPdf({ quarterly, header }) {
  const doc = await loadPdf("quarterly");
  const form = doc.getForm();
  fillHeader(form, header);
  const q = quarterly || {};
  setMoney(form, f0("L8[0]"), q.box8);
  setMoney(form, f0("L9[0]"), q.box9);
  setMoney(form, f0("L10[0]"), q.box10);
  setMoney(form, f0("L11[0]"), q.box11);
  setMoney(form, f0("L12[0]"), q.box12);
  setMoney(form, f0("L13[0]"), q.box13);
  setMoney(form, f0("L14[0]"), q.box14);
  setMoney(form, f0("L15[0]"), q.box15);
  return savePdf(doc);
}

/** Pasqyra vjetore CD */
async function fillAnnualCdPdf({ annual, header }) {
  const doc = await loadPdf("annualCd");
  const form = doc.getForm();
  const h = { ...(header || {}), ...(annual?.header || {}) };
  h.period = h.period || String(annual?.year || "");
  h.nui = h.nui || h.brn || "";
  h.bizName = h.bizName || h.name || "";
  fillHeader(form, h);

  const tot = annual?.totals || {};
  const cd = annual?.cd_boxes || {};

  // Faqja 1 — rregullime / fitimi
  setMoney(form, f0("L10[0]"), cd["[10] Të ardhurat neto (DF)"] ?? tot.netProfit);
  setMoney(form, f0("L11[0]"), cd["[11] Të ardhura me burim të huaj"] || 0);
  setMoney(form, f0("L12[0]"), cd["[12] Arkëtimi i borxheve të këqija"] || 0);
  setMoney(form, f0("L13[0]"), cd["[13] Fitimet kapitale"] || 0);
  setMoney(form, f0("L14[0]"), cd["[14] Dividentet"] || 0);
  setMoney(form, f0("L15[0]"), cd["[15] Të ardhura/fitime të tjera"] || 0);
  setMoney(form, f0("L16[0]"), cd["[16] Rregullimi total në të ardhura"] || 0);
  setMoney(form, f0("L17[0]"), cd["[17] Fitimi pas rregullimit"] ?? tot.netProfit);
  setMoney(form, f0("L18[0]"), cd["[18] Shpenzimet e pazbritshme"] || 0);

  // Faqja 2 — aktiviteti / COGS
  setMoney(form, f1("L60[0]"), cd["[60] Të ardhurat bruto operative"] ?? tot.revenue);
  setMoney(form, f1("L61[0]"), cd["[61] Stoku në fillim"] ?? tot.stockStart);
  setMoney(form, f1("L62[0]"), cd["[62] Blerjet apo kostoja e prodhimit"] ?? tot.purchases);
  setMoney(form, f1("L63[0]"), cd["[63] Totali ([61]+[62])"] ?? moneyNum(tot.stockStart) + moneyNum(tot.purchases));
  setMoney(form, f1("L64[0]"), cd["[64] Stoku në fund"] ?? tot.stockEnd);
  setMoney(form, f1("L65[0]"), cd["[65] Kostoja e mallrave të shitura"] ?? tot.cogs);
  setMoney(form, f1("L66[0]"), cd["[66] Bruto fitimi"] ?? tot.grossProfit);
  setMoney(form, f1("L67[0]"), cd["[67] Pagat bruto"] ?? tot.wages);
  setMoney(form, f1("L78[0]"), cd["[78] Të ardhurat neto (→ kutia 10)"] ?? tot.netProfit);

  return savePdf(doc);
}

function moneyNum(n) {
  return Number(n) || 0;
}

module.exports = {
  PDF_FILES,
  fillVatDeclarationPdf,
  fillWithholdingPayrollPdf,
  fillRentFormPdf,
  fillQuarterlyPdf,
  fillAnnualCdPdf,
};
