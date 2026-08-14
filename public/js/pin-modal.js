/** Modal PIN 4-shifror — funksionon në telefon (jo prompt). */
(function (global) {
  let overlay = null;
  let displayEl = null;
  let titleEl = null;
  let hintEl = null;
  let errorEl = null;
  let confirmBtn = null;
  let pin = "";
  let resolver = null;

  function ensure() {
    if (overlay) return;
    overlay = document.getElementById("pin-modal-overlay");
    displayEl = document.getElementById("pin-modal-display");
    titleEl = document.getElementById("pin-modal-title");
    hintEl = document.getElementById("pin-modal-hint");
    errorEl = document.getElementById("pin-modal-error");
    confirmBtn = document.getElementById("pin-modal-confirm");
    if (!overlay) return;

    overlay.querySelector(".pin-modal-backdrop")?.addEventListener("click", cancel);
    document.getElementById("pin-modal-cancel")?.addEventListener("click", cancel);
    confirmBtn?.addEventListener("click", submit);
    document.getElementById("pin-modal-keypad")?.addEventListener("click", onKeypadClick);
  }

  function render() {
    if (!displayEl) return;
    const filled = pin.split("").map(() => "●").join(" ");
    const empty = Array(Math.max(0, 4 - pin.length)).fill("○").join(" ");
    displayEl.textContent = [filled, empty].filter(Boolean).join(" ") || "○ ○ ○ ○";
    if (confirmBtn) confirmBtn.disabled = pin.length !== 4;
  }

  function showError(msg) {
    if (!errorEl) return;
    if (!msg) {
      errorEl.hidden = true;
      errorEl.textContent = "";
      return;
    }
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  function close() {
    if (!overlay) return;
    overlay.hidden = true;
    overlay.classList.add("hidden");
    pin = "";
    showError("");
    render();
  }

  function cancel() {
    close();
    if (resolver) {
      const r = resolver;
      resolver = null;
      r(null);
    }
  }

  function submit() {
    if (pin.length !== 4) {
      showError("Shkruani 4 shifra PIN.");
      return;
    }
    const value = pin;
    close();
    if (resolver) {
      const r = resolver;
      resolver = null;
      r(value);
    }
  }

  function onKeypadClick(e) {
    const btn = e.target.closest("[data-pin-digit], [data-pin-action]");
    if (!btn) return;
    showError("");
    const digit = btn.dataset.pinDigit;
    const action = btn.dataset.pinAction;
    if (digit != null) {
      if (pin.length >= 4) return;
      pin += digit;
      render();
      if (pin.length === 4) submit();
      return;
    }
    if (action === "back") {
      pin = pin.slice(0, -1);
      render();
      return;
    }
    if (action === "clear") {
      pin = "";
      render();
    }
  }

  function request(options = {}) {
    ensure();
    if (!overlay) {
      return Promise.resolve(window.prompt(options.title || "PIN (4 shifra):") || null);
    }
    return new Promise(resolve => {
      resolver = resolve;
      pin = "";
      if (titleEl) titleEl.textContent = options.title || "PIN kamarieri";
      if (hintEl) hintEl.textContent = options.hint || "Shkruani PIN-in 4-shifror të kamarierit";
      showError("");
      render();
      overlay.hidden = false;
      overlay.classList.remove("hidden");
    });
  }

  global.OrderPinModal = { request };
})(window);
