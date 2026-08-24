/**
 * Eksport Excel ATK — mbush template-et zyrtare (në kontabilisti-templates/).
 */
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

const TEMPLATES_DIR = path.join(__dirname, "kontabilisti-templates");

const FILES = {
  salesVat: "Libri i Shitjes TVSH.xlsx",
  purchaseVat: "Libri i Blerjet  TVSH.xlsx",
  salesQuarterly: "Libri i Shitjes Kuartale.xlsx",
  purchaseQuarterly: "Libri i Blerjes - Kuartale.xlsx",
  rentList: "Lista e Qerase.xlsx",
  annual: "Pasqyrat Vjetore.xlsx",
};

function templatePath(key) {
  const name = FILES[key];
  if (!name) throw new Error("Template ATK i panjohur");
  const p = path.join(TEMPLATES_DIR, name);
  if (!fs.existsSync(p)) throw new Error("Mungon template: " + name);
  return p;
}

async function loadTemplate(key) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(templatePath(key));
  return wb;
}

function clearFromRow(ws, startRow) {
  const max = ws.rowCount || startRow;
  for (let r = max; r >= startRow; r -= 1) {
    const row = ws.getRow(r);
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.value = null;
    });
  }
}

/** Libri i Shitjes TVSH — rreshti 4+ */
async function buildSalesVatXlsx(bookRows) {
  const wb = await loadTemplate("salesVat");
  const ws = wb.getWorksheet(1) || wb.worksheets[0];
  clearFromRow(ws, 4);
  let r = 4;
  for (const row of bookRows || []) {
    const values = [
      row.nr,
      row.date,
      row.invoice_number,
      row.buyer_name || "",
      row.buyer_fiscal || "",
      row.buyer_vat || "",
      row.box9 || 0,
      row.box10a || 0,
      row.box10b || 0,
      row.box10c || 0,
      row.box10 || 0,
      row.box11 || 0,
      row.box12 || 0,
      row.box16 || 0,
      row.box20 || 0,
      row.box24 || 0,
      row.box28 || 0,
      row.boxK1 || 0,
      row.box14 || 0,
      row.box18 || 0,
      row.box22 || 0,
      row.box26 || 0,
      row.boxK2 || 0,
      row.box30 || 0,
    ];
    values.forEach((v, i) => {
      ws.getCell(r, i + 1).value = v;
    });
    r += 1;
  }
  return wb.xlsx.writeBuffer();
}

/** Libri i Blerjes TVSH — rreshti 4+ */
async function buildPurchaseVatXlsx(bookRows) {
  const wb = await loadTemplate("purchaseVat");
  const ws = wb.getWorksheet(1) || wb.worksheets[0];
  clearFromRow(ws, 4);
  let r = 4;
  for (const row of bookRows || []) {
    const values = [
      row.nr,
      row.date,
      row.invoice_number,
      row.seller_name || "",
      row.seller_fiscal || "",
      row.seller_vat || "",
      row.box31 || 0,
      row.box32 || 0,
      row.box33 || 0,
      row.box34 || 0,
      row.box35 || 0,
      row.box39 || 0,
      row.box43 || 0,
      row.box47 || 0,
      row.box53 || 0,
      row.box57 || 0,
      row.box61 || 0,
      row.box65 || 0,
      row.boxK1 || 0,
      row.box37 || 0,
      row.box41 || 0,
      row.box45 || 0,
      row.box49 || 0,
      row.box51 || 0,
      row.box55 || 0,
      row.box59 || 0,
      row.box63 || 0,
      row.boxK2 || 0,
      row.box67 || 0,
    ];
    values.forEach((v, i) => {
      ws.getCell(r, i + 1).value = v;
    });
    r += 1;
  }
  return wb.xlsx.writeBuffer();
}

/** Libri i Shitjes Kuartale — rreshti 4+ (header 1–3) */
async function buildSalesQuarterlyXlsx(bookRows) {
  const wb = await loadTemplate("salesQuarterly");
  const ws = wb.getWorksheet(1) || wb.worksheets[0];
  clearFromRow(ws, 4);
  let r = 4;
  for (const row of bookRows || []) {
    const values = [
      row.nr,
      row.date,
      row.invoice_number,
      row.buyer_name || "",
      row.buyer_nui || "",
      row.col_a || 0,
      row.col_b || 0,
      row.col_c || 0,
      row.col_d || 0,
    ];
    values.forEach((v, i) => {
      ws.getCell(r, i + 1).value = v;
    });
    r += 1;
  }
  return wb.xlsx.writeBuffer();
}

/** Libri i Blerjes Kuartale — rreshti 4+ */
async function buildPurchaseQuarterlyXlsx(bookRows) {
  const wb = await loadTemplate("purchaseQuarterly");
  const ws = wb.getWorksheet(1) || wb.worksheets[0];
  clearFromRow(ws, 4);
  let r = 4;
  for (const row of bookRows || []) {
    const values = [
      row.nr,
      row.date,
      row.invoice_number,
      row.seller_name || "",
      row.seller_nui || "",
      row.col_a || 0,
      row.col_b || 0,
      row.col_c || 0,
      row.col_d || 0,
      row.col_e || 0,
      row.col_f || 0,
      row.col_g || 0,
    ];
    values.forEach((v, i) => {
      ws.getCell(r, i + 1).value = v;
    });
    r += 1;
  }
  return wb.xlsx.writeBuffer();
}

/**
 * Lista e pagave — template .xls nuk lexohet mirë; krijojmë .xlsx me kolonat ATK.
 */
async function buildPayrollXlsx(payrollRows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  const headers = [
    "Emri",
    "Mbiemri",
    "Numri Individual i punëtorit",
    "Bruto paga për muaj",
    "Kontributi pensional i të punësuarit",
    "Kontributi pensional i punëdhënësit",
    "Kontributi suplementar i të punësuarit",
    "Kontributi suplementar i punëdhënësit",
    "Punë Primare",
    "Përfshihen Kontributet",
    "Aplikohet Tatimi në Paga",
    "",
  ];
  const letters = ["a", "b", "c", "d", "e=(d*5%)", "f=(d*5%)", "g", "h", "i", "j", "k", "PO"];
  headers.forEach((h, i) => {
    ws.getCell(1, i + 1).value = h;
  });
  letters.forEach((h, i) => {
    ws.getCell(2, i + 1).value = h;
  });
  let r = 3;
  for (const row of payrollRows || []) {
    const vals = [
      row.first_name || "",
      row.last_name || "",
      row.individual_number || "",
      Number(row.gross_salary) || 0,
      Number(row.employee_pension) || 0,
      Number(row.employer_pension) || 0,
      Number(row.employee_supplement) || 0,
      Number(row.employer_supplement) || 0,
      Number(row.primary_job) !== 0 ? "PO" : "JO",
      Number(row.include_contributions) !== 0 ? "PO" : "JO",
      Number(row.apply_wage_tax) !== 0 ? "PO" : "JO",
      "PO",
    ];
    vals.forEach((v, i) => {
      ws.getCell(r, i + 1).value = v;
    });
    r += 1;
  }
  return wb.xlsx.writeBuffer();
}

/** Lista e Qerase — header rreshti 1, numra rreshti 2, të dhënat nga 3 */
async function buildRentListXlsx(rentRows) {
  const wb = await loadTemplate("rentList");
  const ws = wb.getWorksheet(1) || wb.worksheets[0];
  clearFromRow(ws, 3);
  let r = 3;
  let nr = 0;
  for (const row of rentRows || []) {
    nr += 1;
    const vals = [
      nr,
      row.nui || "",
      row.party_name || "",
      Number(row.interest) || 0,
      Number(row.royalties) || 0,
      Number(row.lottery) || 0,
      Number(row.tmb_other) || 0,
      Number(row.rent_gross) || 0,
      Number(row.non_resident_entertainment) || 0,
      Number(row.non_resident_services) || 0,
      Number(row.tmb_non_resident) || 0,
      Number(row.special_payments) || 0,
      Number(row.area_m2) || 0,
      Number(row.monthly_rent) || 0,
      row.country || "Kosovë",
    ];
    vals.forEach((v, i) => {
      ws.getCell(r, i + 1).value = v;
    });
    r += 1;
  }
  return wb.xlsx.writeBuffer();
}

/**
 * Pasqyrat Vjetore — mbush të 4 fletët (P-A, B-Gj, PNE, Prr-P) + fletë CD.
 */
async function buildAnnualXlsx(annual) {
  const wb = await loadTemplate("annual");
  const header = annual?.header || {};
  const year = annual?.year || new Date().getFullYear();
  const prevY = year - 1;
  const map = {};
  for (const row of annual?.income_statement || []) {
    map[row.label] = row;
  }
  const bs = annual?.balance_sheet || {};
  const bsp = bs.prior || {};
  const cf = annual?.cash_flow || {};
  const tot = annual?.totals || {};

  function setYE(ws, row, cur, pri) {
    ws.getCell(row, 4).value = Number(cur) || 0;
    ws.getCell(row, 5).value = Number(pri) || 0;
  }

  // ─── P-A ───
  const pa = wb.getWorksheet("P-A") || wb.worksheets[0];
  pa.getCell("B2").value = `Emri i kompanisë: ${header.bizName || ""}`;
  pa.getCell("B3").value = `Numri Unik Identifikues: ${header.nui || ""}`;
  pa.getCell("B4").value = `Adresa: ${header.address || ""}`;
  pa.getCell("B8").value = `për vitin që përfundon më 31 dhjetor ${year}`;
  pa.getCell("D9").value = year;
  pa.getCell("E9").value = prevY;

  const paLines = [
    [11, "Të hyrat"],
    [12, "Kostoja e shitjes"],
    [13, "Fitimi / (humbja) bruto"],
    [14, "Të ardhurat tjera"],
    [15, "Shpenzimet administrative"],
    [16, "Shpenzimet e shpërndarjes"],
    [17, "Shpenzimet e tjera"],
    [18, "Fitimi / (humbja) operativ"],
    [19, "Shpenzimet financiare"],
    [20, "Të ardhurat financiare"],
    [21, "Fitimi / (humbja) para tatimit"],
    [22, "Shpenzimet e tatimit në fitim"],
    [23, "Fitimi / (humbja) i/e vitit"],
    [24, "Fitimet (Humbjet) e mbajtura në fillim të vitit"],
    [25, "Dividenda"],
    [26, "Fitimet e mbajtura në fund të vitit"],
  ];
  for (const [row, key] of paLines) {
    const src = map[key];
    if (src) setYE(pa, row, src.current, src.prior);
  }

  // ─── B-Gj bilanci ───
  const bg = wb.getWorksheet("B-Gj");
  if (bg) {
    bg.getCell("B3").value = `më 31 dhjetor ${year}`;
    bg.getCell("D4").value = year;
    bg.getCell("E4").value = prevY;
    setYE(bg, 8, bs.cash, bsp.cash);
    setYE(bg, 10, bs.stock, bsp.stock);
    setYE(bg, 12, bs.currentAssets, bsp.currentAssets);
    setYE(bg, 20, 0, 0);
    setYE(bg, 21, bs.totalAssets, bsp.totalAssets);
    setYE(bg, 28, bs.taxPayable, bsp.taxPayable);
    setYE(bg, 32, bs.currentLiabilities, bsp.taxPayable);
    setYE(bg, 39, bs.totalLiabilities, bsp.taxPayable);
    setYE(bg, 42, bs.retained, bsp.retained);
    setYE(bg, 44, bs.totalEquity, bsp.totalEquity);
    setYE(bg, 45, bs.equityAndLiabilities, bsp.equityAndLiabilities);
  }

  // ─── PNE ndryshimet në ekuitet ───
  const pne = wb.getWorksheet("PNE");
  if (pne) {
    pne.getCell("B2").value = `për vitin që përfundon më 31 dhjetor ${year}`;
    // Vit i kaluar
    pne.getCell(5, 4).value = 0;
    pne.getCell(5, 6).value = 0;
    pne.getCell(7, 4).value = Number(map["Fitimi / (humbja) i/e vitit"]?.prior) || 0;
    pne.getCell(7, 6).value = Number(map["Fitimi / (humbja) i/e vitit"]?.prior) || 0;
    pne.getCell(12, 4).value = Number(bsp.retained) || 0;
    pne.getCell(12, 6).value = Number(bsp.retained) || 0;
    // Vit aktual
    pne.getCell(13, 4).value = Number(bsp.retained) || 0;
    pne.getCell(13, 6).value = Number(bsp.retained) || 0;
    pne.getCell(14, 4).value = Number(tot.netProfit) || 0;
    pne.getCell(14, 6).value = Number(tot.netProfit) || 0;
    pne.getCell(19, 4).value = Number(bs.retained) || 0;
    pne.getCell(19, 6).value = Number(bs.retained) || 0;
    // Update year labels in row titles if present
    pne.getCell(5, 2).value = `Gjendja më 1 janar ${prevY}`;
    pne.getCell(12, 2).value = `Gjendja më 31 dhjetor ${prevY}`;
    pne.getCell(13, 2).value = `Gjendja më 1 janar ${year}`;
    pne.getCell(19, 2).value = `Gjendja më 31 dhjetor ${year}`;
  }

  // ─── Prr-P rrjedha e parasë ───
  const prr = wb.getWorksheet("Prr-P");
  if (prr) {
    prr.getCell("B2").value = `për vitin që përfundon më 31 dhjetor ${year}`;
    prr.getCell("D3").value = year;
    prr.getCell("E3").value = prevY;
    setYE(prr, 6, cf.netProfit, cf.priorNetProfit);
    setYE(prr, 14, tot.tax, bsp.taxPayable);
    setYE(prr, 15, moneySafe(cf.netProfit) + moneySafe(tot.tax), moneySafe(cf.priorNetProfit));
    setYE(prr, 18, cf.stockChange, 0);
    setYE(prr, 24, cf.operatingNet, moneySafe(cf.priorNetProfit));
    setYE(prr, 32, 0, 0);
    setYE(prr, 39, 0, 0);
    setYE(prr, 40, cf.cashNetChange, 0);
    setYE(prr, 41, cf.cashStart, 0);
    setYE(prr, 42, cf.cashEnd, cf.cashStart);
  }

  // ─── Fletë CD (formulari vjetor TAK) ───
  let cd = wb.getWorksheet("CD");
  if (!cd) cd = wb.addWorksheet("CD");
  cd.getCell(1, 1).value = "FORMULARI I DEKLARIMIT VJETOR (CD) — kutizat ATK";
  cd.getCell(2, 1).value = "Kutia";
  cd.getCell(2, 2).value = "Vlera";
  let r = 3;
  for (const [code, amount] of Object.entries(annual?.cd_boxes || {})) {
    cd.getCell(r, 1).value = code;
    cd.getCell(r, 2).value = typeof amount === "number" ? amount : String(amount ?? "");
    r += 1;
  }

  return wb.xlsx.writeBuffer();
}

function moneySafe(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Deklarata TVSH — Excel i thjeshtë me kutizat (nuk ka xlsx template; PDF është skanim).
 */
async function buildVatDeclarationXlsx(decl) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Deklarata TVSH");
  ws.getCell(1, 1).value = "Deklarata e TVSH-së — kutizat ATK";
  ws.getCell(2, 1).value = "Kutia";
  ws.getCell(2, 2).value = "Shuma (€)";
  let r = 3;
  for (const row of decl?.rows || []) {
    ws.getCell(r, 1).value = row.code;
    ws.getCell(r, 2).value = Number(row.amount) || 0;
    r += 1;
  }
  ws.getCell(r + 1, 1).value = "TVSH e llogaritur";
  ws.getCell(r + 1, 2).value = Number(decl?.vat_calculated) || 0;
  ws.getCell(r + 2, 1).value = "TVSH e zbritshme";
  ws.getCell(r + 2, 2).value = Number(decl?.vat_deductible) || 0;
  ws.getCell(r + 3, 1).value = "TVSH për pagesë / (kthim)";
  ws.getCell(r + 3, 2).value = Number(decl?.vat_payable) || 0;
  ws.getColumn(1).width = 55;
  ws.getColumn(2).width = 14;
  return wb.xlsx.writeBuffer();
}

/**
 * Formulari tremujor — kutizat [8]–[15]
 */
async function buildQuarterlyXlsx(form) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Tremujori");
  ws.getCell(1, 1).value = "Formulari tremujor — Opsioni A";
  const rows = [
    ["[8] Të ardhurat", form.box8],
    ["[9] Shpenzimet", form.box9],
    ["[10] Fitimi", form.box10],
    ["[11] Kësti 10%", form.box11],
    ["[12] 110% viti kaluar / 4", form.box12],
    ["[13] Pagesa e këstit", form.box13],
    ["[14] Tatim i mbajtur (dividentë etj.)", form.box14],
    ["[15] Pagesa totale", form.box15],
  ];
  ws.getCell(2, 1).value = "Kutia";
  ws.getCell(2, 2).value = "Shuma (€)";
  rows.forEach((pair, i) => {
    ws.getCell(3 + i, 1).value = pair[0];
    ws.getCell(3 + i, 2).value = Number(pair[1]) || 0;
  });
  return wb.xlsx.writeBuffer();
}

/**
 * Formulari Tatim në Burim (paga) — kutizat nga withholding
 */
async function buildWithholdingPayrollXlsx(withholding) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Tatim ne Burim");
  ws.getCell(1, 1).value = "Formulari i Tatimit në Burim — Paga";
  const w = withholding || {};
  const rows = [
    ["[8] Pagat Bruto", w.box8],
    ["[9] Tatimi i mbajtur", w.box9],
    ["[10] Nr. total i të punësuarve", w.box10],
    ["[11] Deri 250€", w.box11],
    ["[12] 250.01–450€", w.box12],
    ["[13] Mbi 450€", w.box13],
    ["[16] Numri i punëtorëve", w.box16],
    ["[17] Bruto të ardhurat", w.box17],
    ["[18] Kontributet e të punësuarve", w.box18],
    ["[19] Kontributet e punëdhënësit", w.box19],
    ["[20] Kontributet totale", w.box20],
    ["[22] Kontribute suplementare punëtori", w.box22],
    ["[23] Kontribute suplementare punëdhënës", w.box23],
  ];
  ws.getCell(2, 1).value = "Kutia";
  ws.getCell(2, 2).value = "Vlera";
  rows.forEach((pair, i) => {
    ws.getCell(3 + i, 1).value = pair[0];
    ws.getCell(3 + i, 2).value = Number(pair[1]) || 0;
  });
  return wb.xlsx.writeBuffer();
}

/**
 * Formulari i qerase — kutizat TMB
 */
async function buildRentFormXlsx(form) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Formulari Qerase");
  ws.getCell(1, 1).value = "Formulari i qerase — Tatimi i mbajtur në burim";
  const f = form || {};
  const rows = [
    ["[8] Interesi bruto", f.box8],
    ["[9] Të drejtat pronësore", f.box9],
    ["[10] Fitoret bruto lotari", f.box10],
    ["[12] TMB 10%", f.box12],
    ["[13] Qiraja bruto", f.box13],
    ["[14] TMB mbi qira 9%", f.box14],
    ["[15] Pagesa jo-rezident zbavitës", f.box15],
    ["[16] Pagesa jo-rezident shërbime", f.box16],
    ["[17] TMB jo-rezident", f.box17],
    ["[18] TMB total", f.box18],
  ];
  ws.getCell(2, 1).value = "Kutia";
  ws.getCell(2, 2).value = "Shuma (€)";
  rows.forEach((pair, i) => {
    ws.getCell(3 + i, 1).value = pair[0];
    ws.getCell(3 + i, 2).value = Number(pair[1]) || 0;
  });
  return wb.xlsx.writeBuffer();
}

module.exports = {
  FILES,
  TEMPLATES_DIR,
  buildSalesVatXlsx,
  buildPurchaseVatXlsx,
  buildSalesQuarterlyXlsx,
  buildPurchaseQuarterlyXlsx,
  buildPayrollXlsx,
  buildRentListXlsx,
  buildAnnualXlsx,
  buildVatDeclarationXlsx,
  buildQuarterlyXlsx,
  buildWithholdingPayrollXlsx,
  buildRentFormXlsx,
};
