/**
 * Tregues LAN (SSE + health POS) — bottom-left, të gjitha panelët staf.
 */
(function lanStatusIndicator(global) {
  if (typeof document === "undefined") return;

  let lastHealthOk = false;
  let barEl = null;

  function sseConnected() {
    return !!(global.LocalStaffEvents && typeof global.LocalStaffEvents.isConnected === "function"
      && global.LocalStaffEvents.isConnected());
  }

  function isLanConnected() {
    return sseConnected() && lastHealthOk;
  }

  function emitStatusChange() {
    try {
      global.dispatchEvent(new CustomEvent("staff-lan-status-changed", {
        detail: { connected: isLanConnected(), sse: sseConnected(), health: lastHealthOk },
      }));
    } catch {
      /* ignore */
    }
  }

  function ensureBar() {
    if (barEl && document.body.contains(barEl)) return barEl;
    barEl = document.getElementById("lan-status-bar");
    if (barEl) return barEl;
    barEl = document.createElement("div");
    barEl.id = "lan-status-bar";
    barEl.className = "lan-status-bar lan-disconnected";
    barEl.setAttribute("aria-live", "polite");
    barEl.innerHTML =
      '<span class="lan-status-dot" aria-hidden="true"></span>'
      + '<span class="lan-status-label" id="lan-status-label">Pa lidhje</span>';
    document.body.appendChild(barEl);
    return barEl;
  }

  function refreshUi() {
    const bar = ensureBar();
    const label = bar.querySelector(".lan-status-label") || document.getElementById("lan-status-label");
    const ok = isLanConnected();
    bar.classList.toggle("lan-connected", ok);
    bar.classList.toggle("lan-disconnected", !ok);
    if (label) label.textContent = ok ? "Lidhur" : "Pa lidhje";
    emitStatusChange();
  }

  function setHealthOk(ok) {
    lastHealthOk = !!ok;
    refreshUi();
  }

  /** Polling adaptiv: 8s pa LAN, 30s me LAN (përdor fallbackIntervalMs). */
  function startAdaptivePoll(fn, fastMs, slowMs) {
    const fast = Number(fastMs) || 8000;
    const slow = Number(slowMs) || 30000;
    let timer = null;
    let busy = false;

    const schedule = () => {
      if (timer) clearTimeout(timer);
      const ms = typeof global.LocalStaffEvents?.fallbackIntervalMs === "function"
        ? global.LocalStaffEvents.fallbackIntervalMs(fast, slow)
        : (isLanConnected() ? Math.max(slow, 30000) : fast);
      timer = setTimeout(tick, ms);
    };

    const tick = async () => {
      if (busy) {
        schedule();
        return;
      }
      busy = true;
      try {
        await fn();
      } catch {
        /* ignore */
      } finally {
        busy = false;
        schedule();
      }
    };

    global.addEventListener("staff-lan-status-changed", schedule);
    tick();
    return () => {
      if (timer) clearTimeout(timer);
      global.removeEventListener("staff-lan-status-changed", schedule);
    };
  }

  global.LanStatus = {
    isLanConnected,
    setHealthOk,
    refresh: refreshUi,
    startAdaptivePoll,
  };

  function boot() {
    ensureBar();
    refreshUi();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(typeof window !== "undefined" ? window : globalThis);
