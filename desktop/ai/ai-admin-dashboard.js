/**
 * AI paneli super-admin — përdorimi i tokenëve (lexohet nga cloud Super Admin).
 * Desktop HOTEL nuk është paneli super-admin; eksporton helper për dokumentim / proxy.
 */
const aiCloud = require("../ai-cloud");

async function getLocalUsage(db, { month } = {}) {
  return aiCloud.fetchAiUsageFromCloud(db, { month });
}

module.exports = {
  getLocalUsage,
  /** URL relative për Super Admin (telefon/web ops). */
  SUPER_AI_USAGE_PATH: "/api/super/ai-usage",
  SUPER_AI_INVOICE_PDF_PATH: "/api/super/ai-usage/invoice-pdf",
  init() {
    /* no-op */
  },
};
