"use strict";
/**
 * Dita e biznesit — Europe/Belgrade (Kosovë), jo UTC.
 * daily_log vazhdon me date('now','localtime') në SQLite (ora e Windows-it).
 */

const BUSINESS_TZ = "Europe/Belgrade";

const ymdFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function businessYmd(d = new Date()) {
  return ymdFormatter.format(d);
}

function businessYesterdayYmd(d = new Date()) {
  return addBusinessDays(businessYmd(d), -1);
}

/** Shto/zbrit ditë kalendarike (YYYY-MM-DD) pa UTC drift. */
function addBusinessDays(ymd, days) {
  const [y, m, day] = String(ymd || "").slice(0, 10).split("-").map(Number);
  if (!y || !m || !day) return businessYmd();
  const dt = new Date(y, m - 1, day);
  dt.setDate(dt.getDate() + Number(days) || 0);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function businessZonedParts(d = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** Zona e sistemit (Windows) vs dita e biznesit — për paralajmërim Admin. */
function systemTimezoneId() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

function isSystemTimezoneBusinessAligned() {
  const tz = systemTimezoneId();
  if (!tz) return true;
  return tz === BUSINESS_TZ;
}

function pcTimezoneMismatchWarning() {
  if (isSystemTimezoneBusinessAligned()) return null;
  const tz = systemTimezoneId() || "e panjohur";
  return `Ora e kompjuterit nuk është ora e Kosovës (${BUSINESS_TZ}). Tani: ${tz}. Rregulloje në Windows — Settings → Time & language → Time zone.`;
}

module.exports = {
  BUSINESS_TZ,
  businessYmd,
  businessYesterdayYmd,
  addBusinessDays,
  businessZonedParts,
  systemTimezoneId,
  isSystemTimezoneBusinessAligned,
  pcTimezoneMismatchWarning,
};
