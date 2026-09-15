/**
 * AI raport javor (via cloud /api/ai).
 */
const aiCloud = require("../ai-cloud");

async function listWeeklyReports(db, { limit = 12 } = {}) {
  return aiCloud.fetchOwnerAi(db, "/api/ai/weekly-reports", {
    query: { limit },
  });
}

async function generateWeeklyReport(db, { weekStart, sendEmail = false, force = false } = {}) {
  return aiCloud.postOwnerAi(db, "/api/ai/weekly-reports/generate", {
    week_start: weekStart || undefined,
    send_email: sendEmail,
    force,
  });
}

module.exports = {
  listWeeklyReports,
  generateWeeklyReport,
  init() {},
};
