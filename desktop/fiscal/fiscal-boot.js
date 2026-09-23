/**
 * fiscal/fiscal-boot.js — profil nisjeje fiskale + sinkronizim ATK nga settings (parity BIZNES).
 */
const { getLocalRunStatus } = require("./fiscal-local-env");

function envTruthy(name) {
  const v = process.env[name];
  if (v === undefined || v === null || String(v).trim() === "") return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function readAtkUrlFromDb(database) {
  try {
    const row = require("./fiscal-config").getFiscalSettings();
    return String(row?.atk_api_url || "").trim();
  } catch {
    return "";
  }
}

/**
 * Lexon atk_send_allowed / atk_auto_send nga DB ose env dhe vendos FISCAL_LOCAL_RUN.
 */
function syncAtkTransmissionFromSettings(database) {
  const db = database || require("../database");
  let sendAllowed =
    envTruthy("HOTEL_ATK_SEND_ALLOWED") ||
    envTruthy("BIZNES_ATK_SEND_ALLOWED") ||
    db.getSetting("atk_send_allowed", "0") === "1";

  const dbAutoSend = db.getSetting("atk_auto_send");
  let autoSend =
    dbAutoSend != null
      ? dbAutoSend === "1"
      : envTruthy("ATK_AUTO_SEND") || db.getSetting("atk_auto_send", "1") === "1";

  const atkUrl = readAtkUrlFromDb(db);
  const isTestHost = /fiskalizimi-test/i.test(atkUrl);

  if (sendAllowed) {
    process.env.FISCAL_LOCAL_RUN = "0";
    process.env.HOTEL_ATK_SEND_ALLOWED = "1";
    process.env.ATK_AUTO_SEND = autoSend ? "1" : "0";
    db.setSetting("atk_send_allowed", "1");
    if (autoSend) db.setSetting("atk_auto_send", "1");
    db.setSetting("local_print_only", "0");

    if (isTestHost) {
      process.env.ATK_TEST_MODE = "1";
      process.env.FISCAL_TEST_MODE = "1";
      db.setSetting("atk_test_mode", "1");
    } else if (process.env.ATK_TEST_MODE == null || String(process.env.ATK_TEST_MODE).trim() === "") {
      process.env.ATK_TEST_MODE = db.getSetting("atk_test_mode", "0") === "1" ? "1" : "0";
      process.env.FISCAL_TEST_MODE = process.env.ATK_TEST_MODE;
    }

    console.log(
      `[fiscal-boot] ATK HTTP=ON · auto_send=${autoSend ? "ON" : "OFF"} · env=${isTestHost ? "TEST" : "LIVE"}`
    );
    return { allowed: true, autoSend, environment: isTestHost ? "TEST" : "LIVE" };
  }

  process.env.FISCAL_LOCAL_RUN = "1";
  process.env.HOTEL_ATK_SEND_ALLOWED = "0";
  process.env.ATK_AUTO_SEND = "0";
  db.setSetting("atk_send_allowed", "0");
  if (!autoSend) db.setSetting("atk_auto_send", "0");
  console.log("[fiscal-boot] ATK HTTP=BLOCKED — bëni onboarding («Lidhu me ATK») pas plotësimit të fushave");
  return { allowed: false, autoSend: false, environment: isTestHost ? "TEST" : "LIVE" };
}

function applyStartupFiscalProfile() {
  if (process.env.ATK_TEST_MODE == null || String(process.env.ATK_TEST_MODE).trim() === "") {
    process.env.ATK_TEST_MODE = "0";
  }
  if (process.env.FISCAL_TEST_MODE == null || String(process.env.FISCAL_TEST_MODE).trim() === "") {
    process.env.FISCAL_TEST_MODE = process.env.ATK_TEST_MODE;
  }
}

function applyLocalRunDatabaseLockdown() {
  try {
    syncAtkTransmissionFromSettings(require("../database"));
  } catch (e) {
    console.warn("[fiscal-boot] atk sync:", e.message || e);
  }
  try {
    const { resetAutoPaperBlockOnStartup } = require("./fiscal-paper-block");
    resetAutoPaperBlockOnStartup();
  } catch (e) {
    console.warn("[fiscal-boot] paper-block reset:", e.message || e);
  }
}

function scheduleStartupSelfTest(delayMs = 2500) {
  const ms = Math.max(500, Number(delayMs) || 2500);
  setTimeout(async () => {
    try {
      const { isFiscalEnabled } = require("./fiscal-config");
      if (!isFiscalEnabled()) return;
      const { runFiscalSelfTest } = require("./fiscal-self-test");
      const report = await runFiscalSelfTest({ print: false });
      const s = report.summary || {};
      console.log(
        `[fiscal-boot] self-test: ${s.passed}/${s.total} OK` +
          (report.ok ? "" : " — ka dështime (shiko log)")
      );
      if (!report.ok && Array.isArray(report.results)) {
        for (const r of report.results.filter((x) => !x.pass)) {
          console.warn(`[fiscal-boot]   FAIL ${r.name}: ${r.detail || ""}`);
        }
      }
    } catch (e) {
      console.warn("[fiscal-boot] self-test:", e.message || e);
    }
  }, ms);
}

function logStartupFiscalStatus() {
  try {
    const st = getLocalRunStatus();
    console.log(
      `[fiscal-boot] ATK HTTP=${st.atk_http} | test_mode=${st.atk_test_mode} | persistence=${st.fiscal_persistence}`
    );
  } catch (e) {
    console.warn("[fiscal-boot] status:", e.message || e);
  }
}

module.exports = {
  applyStartupFiscalProfile,
  applyLocalRunDatabaseLockdown,
  syncAtkTransmissionFromSettings,
  scheduleStartupSelfTest,
  logStartupFiscalStatus,
};
