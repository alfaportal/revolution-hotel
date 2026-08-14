const { processDailySupplySuggestions } = require("../services/supplySuggestionService");
const { getZonedParts } = require("../services/aiDailyReportService");

const REPORT_TZ = process.env.REPORT_CRON_TZ || "Europe/Belgrade";
let lastRunKey = "";

function startSupplySuggestionCron() {
  const tick = () => {
    const { date, hour, minute } = getZonedParts();
    const key = `${date}|${hour}:${minute}`;
    if (hour === 8 && minute === 0 && lastRunKey !== key) {
      lastRunKey = key;
      processDailySupplySuggestions(date).catch(err => {
        console.error("[cron] supplySuggestions:", err.message || err);
      });
    }
  };

  tick();
  setInterval(tick, 60 * 1000);
  console.log(`  ⏰ Sugjerime furnizimi: 08:00 (${REPORT_TZ})`);
}

module.exports = {
  startSupplySuggestionCron,
  processDailySupplySuggestions,
};
