const { processTrialNotifications } = require("../services/trialNotificationService");

function startTrialNotificationCron() {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const run = () => {
    processTrialNotifications().catch(err => {
      console.error("[cron] processTrialNotifications:", err.message || err);
    });
  };
  run();
  setInterval(run, DAY_MS);
}

module.exports = {
  startTrialNotificationCron,
  processTrialNotifications,
};
