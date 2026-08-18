/**
 * AI vlerësim kamarierësh — refuzime vs porosi (via cloud /api/ai).
 * Arsyet e refuzimit vijnë nga order_refusal_events (cloud) dhe përfshihen
 * në promptin e analyzeWaiterRatings në server.
 */
const aiCloud = require("../ai-cloud");
const cloudSync = require("../cloud-sync");

async function getWaiterRatings(db, { days = 30, analyze = false } = {}) {
  return aiCloud.fetchOwnerAi(db, "/api/ai/waiter-rating", {
    query: { days, analyze: analyze ? "1" : "0" },
  });
}

async function analyzeWaiterRatings(db, { days = 30, force = false } = {}) {
  return aiCloud.postOwnerAi(db, "/api/ai/waiter-rating/analyze", {
    days,
    force,
  });
}

/** Lista e refuzimeve me arsye — e njëjta e dhënë që përdor AI. */
async function getRefusedOrders(db, opts = {}) {
  return cloudSync.listRefusedOrders(db, opts);
}

module.exports = {
  getWaiterRatings,
  analyzeWaiterRatings,
  getRefusedOrders,
  init() {},
};
