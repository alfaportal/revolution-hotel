const { processOfflineNotifications } = require("../services/offlineNotificationService");

/** Kontrollo çdo orë — njoftime email çdo 12h offline (deri 48h / ATK). */
function startOfflineNotificationCron() {
  const HOUR_MS = 60 * 60 * 1000;
  const run = () => {
    processOfflineNotifications().catch((err) => {
      console.error("[cron] processOfflineNotifications:", err.message || err);
    });
  };
  // Vonë 2 min pas start (mos e blloko boot)
  setTimeout(run, 2 * 60 * 1000);
  setInterval(run, HOUR_MS);
}

module.exports = {
  startOfflineNotificationCron,
  processOfflineNotifications,
};
