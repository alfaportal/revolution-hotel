(function () {
  const VIBRATE_PATTERN = [400, 150, 400, 150, 400, 150, 400];

  function vibrateAlert() {
    try {
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(VIBRATE_PATTERN);
      }
    } catch {
      /* Safari / desktop */
    }
  }

  /** Njoftimet OS (Windows toast) janë çaktivizuar — vetëm tingull/vibrim në app. */
  window.requestStaffOrderAlerts = function requestStaffOrderAlerts() {
    return Promise.resolve("disabled");
  };

  window.staffOrderAlertRepeat = function staffOrderAlertRepeat() {
    vibrateAlert();
    if (typeof window.playOrderAlarmSound === "function") {
      window.playOrderAlarmSound();
    }
  };

  window.staffOrderAlert = async function staffOrderAlert(_opts) {
    vibrateAlert();
    if (typeof window.playOrderAlarmSound === "function") {
      await window.playOrderAlarmSound();
    }
  };
})();
