(function (global) {
  "use strict";
  const BUSINESS_TZ = "Europe/Belgrade";
  const ymdFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  function businessYmd(d) {
    return ymdFormatter.format(d || new Date());
  }

  function addBusinessDays(ymd, days) {
    const [y, m, day] = String(ymd || "").slice(0, 10).split("-").map(Number);
    if (!y || !m || !day) return businessYmd();
    const dt = new Date(y, m - 1, day);
    dt.setDate(dt.getDate() + (Number(days) || 0));
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }

  function businessYesterdayYmd(d) {
    return addBusinessDays(businessYmd(d), -1);
  }

  global.HotelBusinessDate = {
    BUSINESS_TZ,
    businessYmd,
    businessYesterdayYmd,
    addBusinessDays,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
