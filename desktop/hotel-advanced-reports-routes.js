const reports = require("./hotel-advanced-reports");
const exp = require("./hotel-advanced-reports-export");

function sendCsv(res, filename, csv) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
}

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

function advancedReportsGuard(_req, res, next) {
  const { packageFeatures } = require("./package-features");
  if (!packageFeatures().advancedReports) {
    return res.status(403).json({
      ok: false,
      error: "Raporte të avancuara kërkojnë Pako 4.",
    });
  }
  next();
}

function registerAdvancedReportsRoutes(app, auth, adminOnly) {
  const gate = [auth, adminOnly, advancedReportsGuard];

  app.get("/api/reports/advanced/weekly", ...gate, (req, res) => {
    try { res.json(reports.getWeeklyReport(req.query.date)); }
    catch (e) { res.status(400).json({ ok: false, error: e.message || String(e) }); }
  });
  app.get("/api/reports/advanced/weekly/export/csv", ...gate, (req, res) => {
    try { sendCsv(res, `raport-javore-${stamp()}.csv`, exp.exportWeeklyCsv(req.query.date).csv); }
    catch (e) { res.status(400).json({ ok: false, error: e.message || String(e) }); }
  });
  app.get("/api/reports/advanced/weekly/export/pdf", ...gate, (req, res) => {
    try { const out = exp.exportWeeklyPdf(req.query.date); res.json({ ok: true, html: out.html, period: out.period }); }
    catch (e) { res.status(400).json({ ok: false, error: e.message || String(e) }); }
  });

  app.get("/api/reports/advanced/monthly", ...gate, (req, res) => {
    try { res.json(reports.getMonthlyReport(req.query.month)); }
    catch (e) { res.status(400).json({ ok: false, error: e.message || String(e) }); }
  });
  app.get("/api/reports/advanced/monthly/export/csv", ...gate, (req, res) => {
    try { sendCsv(res, `raport-mujore-${stamp()}.csv`, exp.exportMonthlyCsv(req.query.month).csv); }
    catch (e) { res.status(400).json({ ok: false, error: e.message || String(e) }); }
  });
  app.get("/api/reports/advanced/monthly/export/pdf", ...gate, (req, res) => {
    try { const out = exp.exportMonthlyPdf(req.query.month); res.json({ ok: true, html: out.html, period: out.period }); }
    catch (e) { res.status(400).json({ ok: false, error: e.message || String(e) }); }
  });

  app.get("/api/reports/advanced/comparison", ...gate, (req, res) => {
    try { res.json(reports.getComparisonReport(req.query.month1, req.query.month2)); }
    catch (e) { res.status(400).json({ ok: false, error: e.message || String(e) }); }
  });
  app.get("/api/reports/advanced/comparison/export/csv", ...gate, (req, res) => {
    try { sendCsv(res, `raport-krahasime-${stamp()}.csv`, exp.exportComparisonCsv(req.query.month1, req.query.month2).csv); }
    catch (e) { res.status(400).json({ ok: false, error: e.message || String(e) }); }
  });
  app.get("/api/reports/advanced/comparison/export/pdf", ...gate, (req, res) => {
    try { const out = exp.exportComparisonPdf(req.query.month1, req.query.month2); res.json({ ok: true, html: out.html, period: out.period }); }
    catch (e) { res.status(400).json({ ok: false, error: e.message || String(e) }); }
  });

  app.get("/api/reports/advanced/trends", ...gate, (req, res) => {
    try { res.json(reports.getTrendsReport()); }
    catch (e) { res.status(400).json({ ok: false, error: e.message || String(e) }); }
  });
  app.get("/api/reports/advanced/trends/export/csv", ...gate, (req, res) => {
    try { sendCsv(res, `raport-trende-${stamp()}.csv`, exp.exportTrendsCsv().csv); }
    catch (e) { res.status(400).json({ ok: false, error: e.message || String(e) }); }
  });
  app.get("/api/reports/advanced/trends/export/pdf", ...gate, (req, res) => {
    try { const out = exp.exportTrendsPdf(); res.json({ ok: true, html: out.html }); }
    catch (e) { res.status(400).json({ ok: false, error: e.message || String(e) }); }
  });

  app.get("/api/reports/advanced/turnover", ...gate, (req, res) => {
    try { res.json(reports.getTurnoverReport(req.query.from, req.query.to)); }
    catch (e) { res.status(400).json({ ok: false, error: e.message || String(e) }); }
  });
  app.get("/api/reports/advanced/turnover/export/csv", ...gate, (req, res) => {
    try { sendCsv(res, `raport-qarkullimi-${stamp()}.csv`, exp.exportTurnoverCsv(req.query.from, req.query.to).csv); }
    catch (e) { res.status(400).json({ ok: false, error: e.message || String(e) }); }
  });
  app.get("/api/reports/advanced/turnover/export/pdf", ...gate, (req, res) => {
    try { const out = exp.exportTurnoverPdf(req.query.from, req.query.to); res.json({ ok: true, html: out.html, period: out.period }); }
    catch (e) { res.status(400).json({ ok: false, error: e.message || String(e) }); }
  });

  app.get("/api/reports/advanced/staff", ...gate, (req, res) => {
    try { res.json(reports.getStaffReport(req.query.from, req.query.to)); }
    catch (e) { res.status(400).json({ ok: false, error: e.message || String(e) }); }
  });
  app.get("/api/reports/advanced/staff/export/csv", ...gate, (req, res) => {
    try { sendCsv(res, `raport-punonjesit-${stamp()}.csv`, exp.exportStaffCsv(req.query.from, req.query.to).csv); }
    catch (e) { res.status(400).json({ ok: false, error: e.message || String(e) }); }
  });
  app.get("/api/reports/advanced/staff/export/pdf", ...gate, (req, res) => {
    try { const out = exp.exportStaffPdf(req.query.from, req.query.to); res.json({ ok: true, html: out.html, period: out.period }); }
    catch (e) { res.status(400).json({ ok: false, error: e.message || String(e) }); }
  });

  app.get("/api/reports/advanced/shifts", ...gate, (req, res) => {
    try { res.json(reports.getShiftsReport(req.query.from, req.query.to)); }
    catch (e) { res.status(400).json({ ok: false, error: e.message || String(e) }); }
  });
  app.get("/api/reports/advanced/shifts/export/csv", ...gate, (req, res) => {
    try { sendCsv(res, `raport-nderrimet-${stamp()}.csv`, exp.exportShiftsCsv(req.query.from, req.query.to).csv); }
    catch (e) { res.status(400).json({ ok: false, error: e.message || String(e) }); }
  });
  app.get("/api/reports/advanced/shifts/export/pdf", ...gate, (req, res) => {
    try { const out = exp.exportShiftsPdf(req.query.from, req.query.to); res.json({ ok: true, html: out.html, period: out.period }); }
    catch (e) { res.status(400).json({ ok: false, error: e.message || String(e) }); }
  });
}

module.exports = { registerAdvancedReportsRoutes };
