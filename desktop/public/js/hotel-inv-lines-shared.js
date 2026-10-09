/** Llogaritje e përbashkët — tabela inv-lines 11 kolona (Blerje, Faturat shitje). */
(function (global) {
  function normalizeLineVat(v) {
    const n = Number(v);
    if (n === 0 || n === 8 || n === 18) return n;
    if (!Number.isFinite(n) || n < 0) return 18;
    if (n <= 8) return 8;
    return 18;
  }

  function invoiceLineAmounts(opts) {
    const vat = normalizeLineVat(opts.vat_rate ?? 18);
    const disc = Math.min(100, Math.max(0, Number(opts.discount_pct) || 0));
    const fDisc = 1 - disc / 100;
    const sasia = Number(opts.sasia) || 0;
    const priceNet = Number(opts.priceNet) || 0;
    const priceGross = Math.round(priceNet * (1 + vat / 100) * 100) / 100;
    const sumNet = Math.round(sasia * priceNet * fDisc * 100) / 100;
    const sumVat = Math.round(sumNet * (vat / 100) * 100) / 100;
    const sumGross = Math.round((sumNet + sumVat) * 100) / 100;
    return { sasia, priceNet, priceGross, sumNet, sumVat, sumGross, disc, vat };
  }

  function lineStockQty(line) {
    const packs = Number(line.pack_qty);
    const ppp = Number(line.pieces_per_pack);
    if (!Number.isFinite(packs) || !Number.isFinite(ppp) || ppp <= 0) return 0;
    return Math.round(packs * ppp * 1000) / 1000;
  }

  function lineVatFactor(line) {
    const r = normalizeLineVat(line.vat_rate);
    return r > 0 ? r / 100 : 0;
  }

  function lineGrossPerPiece(line) {
    const g = Number(line.price_gross);
    if (Number.isFinite(g) && line.price_gross !== "" && line.price_gross != null) return g;
    const legacyPack = Number(line.pack_price);
    const ppp = Number(line.pieces_per_pack) || 1;
    if (Number.isFinite(legacyPack) && legacyPack >= 0) {
      return ppp > 0 ? legacyPack / ppp : legacyPack;
    }
    return 0;
  }

  function lineNetPerPiece(line) {
    const gross = lineGrossPerPiece(line);
    const f = lineVatFactor(line);
    if (f <= 0) return Math.round(gross * 10000) / 10000;
    return Math.round((gross / (1 + f)) * 10000) / 10000;
  }

  function lineSasiaForInvoice(line) {
    if (line.line_sasia !== "" && line.line_sasia != null && Number.isFinite(Number(line.line_sasia))) {
      return Number(line.line_sasia);
    }
    return lineStockQty(line);
  }

  function invoiceLineAmountsFromLine(line) {
    return invoiceLineAmounts({
      sasia: lineSasiaForInvoice(line),
      priceNet: lineNetPerPiece(line),
      discount_pct: line.discount_pct,
      vat_rate: line.vat_rate,
    });
  }

  global.HotelInvLines = {
    normalizeLineVat,
    invoiceLineAmounts,
    invoiceLineAmountsFromLine,
    lineStockQty,
    lineGrossPerPiece,
    lineNetPerPiece,
    lineSasiaForInvoice,
  };
})(typeof window !== "undefined" ? window : global);
