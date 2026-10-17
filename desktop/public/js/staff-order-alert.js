(function () {
  const VIBRATE_PATTERN = [400, 150, 400, 150, 400, 150, 400];
  const NOTIFY_VIBRATE = [300, 100, 300, 100, 300, 100, 300];

  /** Vetëm njoftimet lokale POS — gati për kamarier, porosi e re për kuzhinë. */
  const NOTIFY_KINDS = new Set(["waiter-ready", "kitchen-new"]);

  function normalizeOpts(opts) {
    if (opts == null || opts === "") return {};
    if (typeof opts === "string") return { kind: opts };
    return opts;
  }

  function vibrateAlert() {
    try {
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(VIBRATE_PATTERN);
      }
    } catch {
      /* Safari / desktop */
    }
  }

  async function ensureNotificationPermission() {
    if (!("Notification" in window)) return "unsupported";
    if (Notification.permission === "granted") return "granted";
    if (Notification.permission === "denied") return "denied";
    try {
      return await Notification.requestPermission();
    } catch {
      return "denied";
    }
  }

  let permAskInFlight = null;
  window.requestStaffOrderAlerts = function requestStaffOrderAlerts() {
    if (!permAskInFlight) {
      permAskInFlight = ensureNotificationPermission().finally(() => {
        permAskInFlight = null;
      });
    }
    return permAskInFlight;
  };

  function showSystemNotification(title, body, tag) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      const opts = {
        body: body || "",
        tag: tag || "hotel-staff-order",
        renotify: true,
        requireInteraction: true,
        silent: false,
        icon: "/img/revolution-logo.png",
      };
      if (typeof Notification.prototype !== "undefined") {
        try {
          opts.vibrate = NOTIFY_VIBRATE;
        } catch {
          /* ignore */
        }
      }
      const n = new Notification(title || "Porosi e re!", opts);
      n.onclick = () => {
        try {
          window.focus();
        } catch {
          /* ignore */
        }
        n.close();
      };
    } catch {
      /* iOS / kontekst i kufizuar */
    }
  }

  window.staffOrderAlertRepeat = function staffOrderAlertRepeat() {
    vibrateAlert();
    if (typeof window.playOrderAlarmSound === "function") {
      window.playOrderAlarmSound();
    }
  };

  window.staffOrderAlert = async function staffOrderAlert(opts) {
    opts = normalizeOpts(opts);
    vibrateAlert();
    if (typeof window.playOrderAlarmSound === "function") {
      await window.playOrderAlarmSound();
    }
    const kind = String(opts.kind || "");
    if (!NOTIFY_KINDS.has(kind)) return;

    if (Notification.permission === "default") {
      await ensureNotificationPermission();
    }
    showSystemNotification(
      opts.title || (kind === "waiter-ready" ? "Porosia është gati!" : "Porosi e re!"),
      opts.body
        || (kind === "waiter-ready"
          ? "Shko te banaku dhe merr porosinë."
          : "Hap kuzhinën dhe pranoni porosinë."),
      opts.tag || kind,
    );
  };

  let permPrimed = false;
  function primeNotificationPermissionOnce() {
    if (permPrimed) return;
    permPrimed = true;
    window.requestStaffOrderAlerts();
  }
  ["click", "touchstart", "keydown"].forEach((ev) => {
    document.addEventListener(ev, primeNotificationPermissionOnce, { passive: true, once: true });
  });
})();
