const { getSupabaseForProduct } = require("../lib/productSupabase");
const { todayISO } = require("../lib/licenseDates");

async function expireOnDb(db, today, nowIso) {
  const { data, error } = await db
    .from("licenses")
    .update({ statusi: "skaduar", updated_at: nowIso })
    .eq("statusi", "aktive")
    .lt("data_skadimit", today)
    .select("id");
  if (error) throw error;
  return (data || []).map((r) => r.id);
}

async function expireLicensesDaily() {
  const today = todayISO();
  const nowIso = new Date().toISOString();
  const expiredIds = [];
  for (const product of ["kafene", "market", "hotel"]) {
    try {
      const ids = await expireOnDb(getSupabaseForProduct(product), today, nowIso);
      expiredIds.push(...ids);
      if (ids.length) {
        console.log(`[cron] ${product}: ${ids.length} licenca skaduar (data_skadimit < ${today})`);
      }
    } catch (err) {
      if (product === "kafene") throw err;
      console.warn(`[cron] expire ${product}:`, err.message || err);
    }
  }
  return { expired: expiredIds.length };
}

function startLicenseExpiryCron() {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const run = () => {
    expireLicensesDaily().catch(err => {
      console.error("[cron] expireLicensesDaily:", err.message || err);
    });
  };
  run();
  setInterval(run, DAY_MS);
}

module.exports = {
  expireLicensesDaily,
  startLicenseExpiryCron,
};
