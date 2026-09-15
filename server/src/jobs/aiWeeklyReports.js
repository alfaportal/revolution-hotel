const { processAiWeeklyReports, mondayOf } = require("../services/aiWeeklyReportService");
const { getZonedParts } = require("../services/aiDailyReportService");

const REPORT_TZ = process.env.REPORT_CRON_TZ || "Europe/Belgrade";
let lastRunKey = "";

/** E hënë mëngjes 08:00 — raporti i javës së kaluar. */
function startAiWeeklyReportCron() {
  const tick = () => {
    const { date, hour, minute } = getZonedParts();
    const isMonday = mondayOf(date) === date;
    const key = `${date}|${hour}:${minute}`;
    if (isMonday && hour === 8 && minute === 0 && lastRunKey !== key) {
      lastRunKey = key;
      processAiWeeklyReports(date).catch((err) => {
        console.error("[cron] aiWeeklyReports:", err.message || err);
      });
    }
  };

  tick();
  setInterval(tick, 60 * 1000);
  console.log(`  ⏰ AI weekly reports: e hënë 08:00 (${REPORT_TZ})`);
}

module.exports = {
  startAiWeeklyReportCron,
  processAiWeeklyReports,
};
