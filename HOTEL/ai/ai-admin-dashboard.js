/**
 * AI paneli i Naserit — përdorimi i tokenëve (lexohet nga cloud Super Admin).
 * Desktop KAFENE nuk është paneli i Naserit; eksporton helper për dokumentim / proxy.
 */
const aiCloud = require("../ai-cloud");

async function getLocalUsage(db, { month } = {}) {
  return aiCloud.fetchAiUsageFromCloud(db, { month });
}

module.exports = {
  getLocalUsage,
  /** URL relative për Super Admin (telefon/web Naseri). */
  SUPER_AI_USAGE_PATH: "/api/super/ai-usage",
  SUPER_AI_INVOICE_PDF_PATH: "/api/super/ai-usage/invoice-pdf",
  init() {
    /* no-op */
  },
};
