/** Owner panel — Njoftimet Telegram/SMS (pako_5) */
(function () {
  function setMsg(text, ok) {
    const el = document.getElementById("notify-msg");
    if (!el) return;
    el.textContent = text || "";
    el.className = "owner-license-msg" + (text ? (ok ? " ok" : " err") : "");
  }

  function renderCapabilities(caps) {
    const el = document.getElementById("notify-capabilities");
    if (!el || !caps) return;
    const parts = [];
    parts.push(caps.telegram_configured ? "Telegram: aktiv në server" : "Telegram: mungon TELEGRAM_BOT_TOKEN");
    parts.push(caps.sms_configured ? "SMS Vonage: aktiv" : "SMS: mungon VONAGE_API_KEY");
    el.textContent = parts.join(" · ");
  }

  function fillForm(settings) {
    document.getElementById("notify-telegram-id").value = settings?.telegram_chat_id || "";
    document.getElementById("notify-sms-number").value = settings?.sms_number || "";
    document.getElementById("notify-low-stock").checked = settings?.notify_low_stock !== false;
    document.getElementById("notify-daily-report").checked = settings?.notify_daily_report !== false;
  }

  async function loadOwnerNotifications() {
    setMsg("Duke ngarkuar…", true);
    try {
      const data = await api("/api/owner/notification-settings");
      fillForm(data.settings);
      renderCapabilities(data.capabilities);
      setMsg("", true);
    } catch (err) {
      setMsg(err.message, false);
    }
  }

  async function saveNotifications() {
    setMsg("Duke ruajtur…", true);
    try {
      const data = await api("/api/owner/notification-settings", {
        method: "PUT",
        body: JSON.stringify({
          telegram_chat_id: document.getElementById("notify-telegram-id").value.trim(),
          sms_number: document.getElementById("notify-sms-number").value.trim(),
          notify_low_stock: document.getElementById("notify-low-stock").checked,
          notify_daily_report: document.getElementById("notify-daily-report").checked,
        }),
      });
      fillForm(data.settings);
      renderCapabilities(data.capabilities);
      setMsg("Njoftimet u ruajtën.", true);
    } catch (err) {
      setMsg(err.message, false);
    }
  }

  async function sendTest() {
    setMsg("Duke dërguar test…", true);
    try {
      await api("/api/owner/notification-settings/test", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setMsg("Mesazhi test u dërgua.", true);
    } catch (err) {
      setMsg(err.message, false);
    }
  }

  function applyNotificationsTab(data) {
    window.applyAiFeatureLock?.(document.getElementById("tab-notifications"), data);
  }

  window.loadOwnerNotifications = loadOwnerNotifications;
  window.applyNotificationsTab = applyNotificationsTab;

  document.getElementById("btn-notify-save")?.addEventListener("click", () => {
    saveNotifications().catch(err => setMsg(err.message, false));
  });
  document.getElementById("btn-notify-test")?.addEventListener("click", () => {
    sendTest().catch(err => setMsg(err.message, false));
  });
})();
