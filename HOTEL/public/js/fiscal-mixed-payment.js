/**
 * fiscal-mixed-payment.js — pagesë e përzier (cash + POS + voucher) për kupon fiskal.
 */
(function (global) {
  "use strict";

  function roundMoney(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  function readAmount(id) {
    const el = document.getElementById(id);
    return roundMoney(el ? el.value : 0);
  }

  function buildMixedSplits(ids) {
    const cashId = (ids && ids.cash) || "pay-cash-amt";
    const cardId = (ids && ids.card) || "pay-card-amt";
    const voucherId = (ids && ids.voucher) || "pay-voucher-amt";
    return [
      { method: "cash", amount: readAmount(cashId) },
      { method: "credit_card", amount: readAmount(cardId) },
      { method: "voucher", amount: readAmount(voucherId) },
    ].filter(function (p) {
      return p.amount > 0;
    });
  }

  function getMixedPaymentStatus(invoiceTotal, splits) {
    const total = roundMoney(invoiceTotal);
    const list = Array.isArray(splits) ? splits : [];
    const paid = roundMoney(
      list.reduce(function (s, p) {
        return s + (Number(p.amount) || 0);
      }, 0)
    );
    const diff = roundMoney(total - paid);
    const ok = Math.abs(diff) <= 0.02;
    var kind = "ok";
    var detail = "";
    if (!ok) {
      if (diff > 0.02) {
        kind = "short";
        detail = "Mbeten për pagesë: " + paid.toFixed(2) + " / " + total.toFixed(2) + " €";
      } else {
        kind = "over";
        detail = "Tepricë — zvogëloni shumat";
      }
    }
    return { total: total, paid: paid, diff: diff, ok: ok, kind: kind, detail: detail };
  }

  function formatMixedPaymentBarText(status) {
    var base =
      "Totali i paguar: " +
      status.paid.toFixed(2) +
      " / " +
      status.total.toFixed(2) +
      " €";
    if (status.ok) return base + " — OK ✓";
    return base + " — " + status.detail;
  }

  function formatMixedPaymentError(status) {
    if (status.kind === "short") {
      return (
        "Pagesa e përzier nuk përputhet. Mbeten: " +
        Math.abs(status.diff).toFixed(2) +
        " €. Rregulloni Cash / POS / Voucher."
      );
    }
    if (status.kind === "over") {
      return (
        "Shuma e paguar (" +
        status.paid.toFixed(2) +
        " €) është më e madhe se totali (" +
        status.total.toFixed(2) +
        " €)."
      );
    }
    return "Pagesa e përzier nuk përputhet me totalin.";
  }

  function isMixedEnabled(checkboxId) {
    var id = checkboxId || "pay-mixed";
    var el = document.getElementById(id);
    return !!(el && el.checked);
  }

  function updateMixedPaymentBar(opts) {
    opts = opts || {};
    var checkboxId = opts.checkboxId || "pay-mixed";
    var statusId = opts.statusId || "pay-mixed-status";
    var boxId = opts.boxId || "pay-mixed-box";
    var invoiceTotal = Number(opts.total) || 0;
    var mixedOn = isMixedEnabled(checkboxId);
    var box = document.getElementById(boxId);
    var el = document.getElementById(statusId);
    if (box) box.hidden = !mixedOn;
    if (!mixedOn) {
      if (el) {
        el.hidden = true;
        el.classList.remove("mismatch");
      }
      return { ok: true, mixed: false };
    }
    var splits = buildMixedSplits(opts.ids);
    var status = getMixedPaymentStatus(invoiceTotal, splits);
    if (el) {
      el.hidden = false;
      el.textContent = formatMixedPaymentBarText(status);
      el.classList.toggle("mismatch", !status.ok);
    }
    return { ok: status.ok, mixed: true, splits: splits, status: status };
  }

  function resolveMixedOrSinglePayment(opts) {
    opts = opts || {};
    if (!isMixedEnabled(opts.checkboxId)) {
      return null;
    }
    var total = Number(opts.total) || 0;
    var splits = buildMixedSplits(opts.ids);
    var status = getMixedPaymentStatus(total, splits);
    if (splits.length < 2) {
      throw new Error("Pagesa e përzier kërkon të paktën dy metoda (Cash, POS, Voucher).");
    }
    if (!status.ok) {
      throw new Error(formatMixedPaymentError(status));
    }
    return { payment_method: "mixed", payment_splits: splits };
  }

  global.FiscalMixedPayment = {
    roundMoney: roundMoney,
    buildMixedSplits: buildMixedSplits,
    getMixedPaymentStatus: getMixedPaymentStatus,
    formatMixedPaymentError: formatMixedPaymentError,
    updateMixedPaymentBar: updateMixedPaymentBar,
    resolveMixedOrSinglePayment: resolveMixedOrSinglePayment,
    isMixedEnabled: isMixedEnabled,
  };
})(typeof window !== "undefined" ? window : globalThis);
