(function () {
  "use strict";

  function initWaiterCalculator() {
    const modal = document.getElementById("calc-modal");
    const display = document.getElementById("calc-display");
    const keys = document.getElementById("calc-keys");
    if (!modal || !display || !keys) return;

    let current = "0";
    let stored = null;
    let op = null;
    let fresh = true;

    function formatEuro(n) {
      const val = Number(n);
      return Number.isFinite(val) ? val.toFixed(2) : "0.00";
    }

    function showDisplay() {
      display.textContent = formatEuro(current);
    }

    function clearAll() {
      current = "0";
      stored = null;
      op = null;
      fresh = true;
      showDisplay();
    }

    function appendDigit(d) {
      if (fresh) {
        current = d === "." ? "0." : d;
        fresh = false;
      } else if (d === ".") {
        if (current.includes(".")) return;
        current += ".";
      } else if (current === "0") {
        current = d;
      } else {
        current += d;
      }
      showDisplay();
    }

    function applyOp(a, operator, b) {
      switch (operator) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return b === 0 ? 0 : a / b;
        default: return b;
      }
    }

    function chooseOp(nextOp) {
      const val = parseFloat(current);
      if (stored !== null && op && !fresh) {
        current = String(applyOp(stored, op, val));
        showDisplay();
      }
      stored = parseFloat(current);
      op = nextOp;
      fresh = true;
    }

    function equals() {
      if (op === null || stored === null) return;
      const val = parseFloat(current);
      current = String(applyOp(stored, op, val));
      stored = null;
      op = null;
      fresh = true;
      showDisplay();
    }

    function openModal() {
      modal.classList.remove("hidden");
      modal.removeAttribute("hidden");
    }

    function closeModal() {
      modal.classList.add("hidden");
      modal.setAttribute("hidden", "");
    }

    document.querySelectorAll("[data-open-calc]").forEach(btn => {
      btn.addEventListener("click", openModal);
    });
    document.getElementById("calc-modal-backdrop")?.addEventListener("click", closeModal);
    document.getElementById("calc-modal-close")?.addEventListener("click", closeModal);

    keys.addEventListener("click", e => {
      const btn = e.target.closest("[data-calc]");
      if (!btn) return;
      const action = btn.getAttribute("data-calc");
      if (action === "C") clearAll();
      else if (action === "=") equals();
      else if ("+-*/".includes(action)) chooseOp(action);
      else appendDigit(action);
    });

    clearAll();
  }

  window.initWaiterCalculator = initWaiterCalculator;
})();
