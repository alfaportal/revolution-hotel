/**
 * AI parashikim stoku / porosish (via cloud /api/ai).
 */
const aiCloud = require("../ai-cloud");

async function getStockPredict(db, { days = 30, analyze = false } = {}) {
  return aiCloud.fetchOwnerAi(db, "/api/ai/stock-predict", {
    query: { days, analyze: analyze ? "1" : "0" },
  });
}

async function analyzeStockPredict(db, { days = 30, sendEmail = true } = {}) {
  return aiCloud.postOwnerAi(db, "/api/ai/stock-predict/analyze", {
    days,
    send_email: sendEmail,
  });
}

module.exports = {
  getStockPredict,
  analyzeStockPredict,
  init() {},
};
