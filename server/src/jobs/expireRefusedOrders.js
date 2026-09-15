const { expireRefusedOrders } = require("../services/kdsService");

const INTERVAL_MS = 30_000;

function startRefusedOrdersExpiryJob() {
  const run = () => {
    expireRefusedOrders().catch(err => {
      console.warn("[refusal-expiry]", err.message || err);
    });
  };
  run();
  setInterval(run, INTERVAL_MS);
}

module.exports = { startRefusedOrdersExpiryJob, expireRefusedOrders };
