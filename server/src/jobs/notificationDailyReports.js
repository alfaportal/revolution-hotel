const {
  processMorningDailyReportNotifications,
} = require("../services/pushNotificationService");
const { getZonedParts } = require("../services/aiDailyReportService");

const REPORT_TZ = process.env.REPORT_CRON_TZ || "Europe/Belgrade";
let lastRunKey = "";

function startNotificationDailyCron() {
  const tick = () => {
    const { date, hour, minute } = getZonedParts();
    const key = `${date}|${hour}:${minute}`;
    if (hour === 8 && minute === 0 && lastRunKey !== key) {
      lastRunKey = key;
      processMorningDailyReportNotifications(date).catch(err => {
        console.error("[cron] notificationDaily:", err.message || err);
      });
    }
  };

  tick();
  setInterval(tick, 60 * 1000);
  console.log(`  ⏰ Njoftime raport ditor: 08:00 (${REPORT_TZ})`);
}

module.exports = {
  startNotificationDailyCron,
  processMorningDailyReportNotifications,
};
