/**
 * AI asistent personal — chat me kategori (via cloud /api/ai/owner-chat).
 */
const aiCloud = require("../ai-cloud");

const CATEGORIES = [
  { id: "general", label: "Të gjitha" },
  { id: "shitjet", label: "Shitjet" },
  { id: "stoku", label: "Stoku" },
  { id: "kamarieret", label: "Kamarierët" },
];

async function chat(db, { message, category = "general", history = [] } = {}) {
  return aiCloud.postOwnerAi(db, "/api/ai/owner-chat", {
    message,
    category,
    history,
  });
}

module.exports = {
  CATEGORIES,
  chat,
  init() {},
};
