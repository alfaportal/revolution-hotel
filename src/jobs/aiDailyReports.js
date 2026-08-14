const { processAiDailyReports, getZonedParts } = require("../services/aiDailyReportService");

const REPORT_TZ = process.env.REPORT_CRON_TZ || "Europe/Belgrade";
let lastRunKey = "";

function startAiDailyReportCron() {
  const tick = () => {
    const { date, hour, minute } = getZonedParts();
    const key = `${date}|${hour}:${minute}`;
    if (hour === 23 && minute === 59 && lastRunKey !== key) {
      lastRunKey = key;
      processAiDailyReports(date).catch(err => {
        console.error("[cron] aiDailyReports:", err.message || err);
      });
    }
  };

  tick();
  setInterval(tick, 60 * 1000);
  console.log(`  ⏰ AI daily reports: 23:59 (${REPORT_TZ})`);
}

module.exports = {
  startAiDailyReportCron,
  processAiDailyReports,
};
