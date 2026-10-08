const { getAnthropicVisionConfig } = require("../lib/aiVisionConfig");
const { isAiPaused } = require("../lib/aiConfig");

/**
 * Skanim fature BLERJEJE (Blerjet → kontrollo → Regjistro → stok).
 * Formate: Revolution (11 kolona TVSH) ose furnizues KS (DISKONT etj.).
 */
const EXTRACT_PROMPT =
  "Lexo faturën e FURNIZUESIT drejtuar hotelit/restorantit (blerje stoku).\n" +
  "Formati Revolution (11 kolona — mapo saktë):\n" +
  "Nr | Përshkrimi | Njësia | Sasia | Çmimi pa TVSH | Zbritja % | Çmimi me TVSH | Shuma pa TVSH | TVSH % | Shuma TVSH | Totali me TVSH\n" +
  "Format tjetër (DISKONT etj.): Nr | Pershkrimi | Njesia | Sasia | Cmimi | Rabati | Tatimi | Vlera Pa TVSH | TVSH | Vlera Me TVSH.\n" +
  "\n" +
  "Për ÇDO rresht artikulli DUHET të kesh 4 fusha numerike (mos i përziej neto/bruto):\n" +
  "• unit_price = Çmimi pa TVSH (neto / copë ose / njësi) — kolona «Çmimi pa TVSH».\n" +
  "• unit_price_gross = Çmimi me TVSH (bruto / copë ose / njësi) — kolona «Çmimi me TVSH».\n" +
  "• line_net = Shuma pa TVSH e rreshtit — kolona «Shuma pa TVSH» / Vlera Pa TVSH.\n" +
  "• line_total = Totali me TVSH i rreshtit — kolona «Totali me TVSH» / Vlera Me TVSH.\n" +
  "Në format DISKONT: Cmimi≈unit_price neto; llogarit unit_price_gross dhe line_total me TVSH nëse duhet.\n" +
  "\n" +
  "Tjetër: quantity = Sasia (si në faturë). unit: copë|pako|kg|l. pieces_per_pack: 1 për copë; për pako → copë në pako.\n" +
  "name = Përshkrimi i saktë. vat_rate rresht: 0|8|18 nga TVSH %. MOS rreshta TVSH/total/subtotal si artikull.\n" +
  "supplier = furnizuesi (jo blerësi). supplier_nui, supplier_vat. Header vat_rate. invoice_number, invoice_date YYYY-MM-DD.\n" +
  "total_with_vat = totali për pagesë ME TVSH.\n" +
  "\n" +
  "Përgjigju VETËM me JSON (pa markdown). Shembull items:\n" +
  '{"supplier":"Furnizues SH.P.K.","supplier_nui":"810123456","supplier_vat":"","vat_rate":18,"invoice_number":"SH-2026-0005","invoice_date":"2026-10-07","total_with_vat":95.72,"items":[{"name":"Red Bull 250ml","quantity":20,"unit":"copë","unit_price":1.69,"unit_price_gross":1.99,"line_net":33.80,"line_total":39.80,"pieces_per_pack":1,"vat_rate":18}]}';

function normalizeSupplierNui(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length >= 8 && digits.length <= 12) return digits;
  const s = String(raw || "").trim().replace(/\s+/g, "");
  return s.slice(0, 32);
}

function normalizeScanVatRate(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 18;
  if (n === 0 || n === 8 || n === 18) return n;
  if (n > 0 && n < 1) {
    const pct = Math.round(n * 100);
    if (pct === 8 || pct === 18) return pct;
  }
  if (n <= 0) return 0;
  if (n <= 8) return 8;
  return 18;
}

function parseNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 1000) / 1000;
  }
  let cleaned = String(value ?? "")
    .replace(/\s/g, "")
    .replace(/[^\d.,-]/g, "");
  if (cleaned.includes(",") && cleaned.includes(".")) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (cleaned.includes(",")) {
    cleaned = cleaned.replace(",", ".");
  }
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
}

function normalizeUnit(unit) {
  const u = String(unit || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (/^(pako|pake|pak|box|carton|kutia|kuti)$/.test(u)) return "pako";
  if (/^(kg|kilogram|kilograme|kilo|g|gr|gram)$/.test(u)) return "kg";
  if (/^(l|lt|liter|liter|litra|ml)$/.test(u)) return "l";
  return "copë";
}

function piecesFromName(name) {
  const m = String(name || "").match(/(\d+)\s*cop(?:e|ë|a)?\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Vetëm për unit=pako. Për copë/kg/l → gjithmonë 1. */
function inferPiecesPerPack(name, unit, explicit) {
  const u = normalizeUnit(unit);
  if (u !== "pako") return 1;
  const e = parseNumber(explicit);
  if (e != null && e > 0) return Math.max(1, Math.round(e));
  const fromName = piecesFromName(name);
  if (fromName) return fromName;
  return 24;
}

function normalizeInvoiceItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];

  const seen = new Set();
  const items = [];

  for (const entry of rawItems) {
    const name = String(entry?.name ?? entry?.emri ?? entry?.product ?? entry?.artikull ?? "").trim();
    if (!name) continue;
    if (/^(tvsh|vat|total|subtotal|zbritje|rabate|transport|shipping|raundim|vlera\s+neto|vlera\s+per)/i.test(name)) {
      continue;
    }

    const quantity = parseNumber(entry?.quantity ?? entry?.sasia ?? entry?.qty ?? entry?.amount);
    const unit = normalizeUnit(entry?.unit ?? entry?.njesia ?? entry?.njësia ?? "copë");
    const unit_price = parseNumber(
      entry?.unit_price ??
        entry?.unit_price_net ??
        entry?.price_net ??
        entry?.cmimi_pa_tvsh ??
        entry?.price ??
        entry?.cmimi ??
        entry?.cost ??
        entry?.unit_cost,
    );
    const unit_price_gross = parseNumber(
      entry?.unit_price_gross ??
        entry?.price_gross ??
        entry?.cmimi_me_tvsh ??
        entry?.gross_unit_price ??
        entry?.unit_gross_price ??
        entry?.cmimi_bruto ??
        entry?.price_with_vat,
    );
    const line_net = parseNumber(
      entry?.line_net ??
        entry?.shuma_pa_tvsh ??
        entry?.vlera_pa_tvsh ??
        entry?.net_line ??
        entry?.line_net_amount ??
        entry?.shuma_net,
    );
    if (quantity == null || quantity <= 0) continue;

    const pieces_per_pack = inferPiecesPerPack(
      name,
      unit,
      entry?.pieces_per_pack ?? entry?.copa_ne_pako ?? entry?.pieces,
    );
    const line_total = parseNumber(
      entry?.line_total ??
        entry?.totali_me_tvsh ??
        entry?.vlera_me_tvsh ??
        entry?.line_gross ??
        entry?.vlera ??
        entry?.value ??
        entry?.total,
    );
    let priceNet = unit_price != null && unit_price >= 0 ? unit_price : 0;
    if (!(priceNet > 0) && line_net != null && line_net > 0 && quantity > 0) {
      priceNet = Math.round((line_net / quantity) * 10000) / 10000;
    }
    const lineVatRaw = parseNumber(entry?.vat_rate ?? entry?.tvsh ?? entry?.vat);
    const vat_rate =
      lineVatRaw != null && (lineVatRaw === 0 || lineVatRaw === 8 || lineVatRaw === 18)
        ? lineVatRaw
        : undefined;

    const key = `${name.toLowerCase()}|${quantity}|${unit}|${pieces_per_pack}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      name,
      quantity,
      unit,
      unit_price: priceNet,
      pieces_per_pack,
      ...(unit_price_gross != null && unit_price_gross >= 0 ? { unit_price_gross } : {}),
      ...(line_net != null && line_net >= 0 ? { line_net } : {}),
      ...(line_total != null && line_total >= 0 ? { line_total } : {}),
      ...(vat_rate != null ? { vat_rate } : {}),
    });
  }

  return items;
}

function extractJsonPayload(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("AI nuk ktheu përgjigje.");

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : trimmed).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("AI nuk ktheu JSON valid për faturën.");
  }
}

function qtyPriceMatchesLineTotal(qty, unitPrice, lineTotal, vatPercent = 18) {
  const net = Math.round(qty * unitPrice * 100) / 100;
  const got = Math.round(lineTotal * 100) / 100;
  if (!(net > 0) || !(got > 0)) return true;
  const vat = normalizeScanVatRate(vatPercent);
  const tol = Math.max(0.06, net * 0.02);
  if (Math.abs(net - got) <= tol) return true;
  const gross = Math.round(net * (1 + vat / 100) * 100) / 100;
  return Math.abs(gross - got) <= tol;
}

function buildTotalsCheck(items, invoiceTotal, vatRate = 18) {
  const headerVat = normalizeScanVatRate(vatRate);
  const linesSum = items.reduce((sum, it) => {
    if (it.line_total != null && Number.isFinite(it.line_total)) {
      return sum + it.line_total;
    }
    return sum + Number(it.quantity || 0) * Number(it.unit_price || 0);
  }, 0);
  const roundedLines = Math.round(linesSum * 100) / 100;
  const warnings = [];
  let ok = true;
  let invoice_total = null;

  if (invoiceTotal != null && invoiceTotal > 0) {
    invoice_total = Math.round(invoiceTotal * 100) / 100;
    const diff = Math.abs(roundedLines - invoice_total);
    const tolerance = Math.max(0.5, invoice_total * 0.12);
    if (diff > tolerance) {
      ok = false;
      warnings.push(
        `Shuma e rreshtave (${roundedLines.toFixed(2)} €) nuk përputhet mirë me totalin e faturës (${invoice_total.toFixed(2)} €). Kontrollo sasitë/çmimet para se të regjistrosh.`,
      );
    }
  }

  for (const it of items) {
    if (it.line_total == null || it.unit_price == null) continue;
    const qty = Number(it.quantity) || 0;
    const price = Number(it.unit_price) || 0;
    const got = Math.round(it.line_total * 100) / 100;
    const lineVat = normalizeScanVatRate(
      it.vat_rate != null && it.vat_rate !== "" ? it.vat_rate : headerVat,
    );
    if (!qtyPriceMatchesLineTotal(qty, price, got, lineVat)) {
      const expected = Math.round(qty * price * 100) / 100;
      warnings.push(
        `Rreshti «${it.name}»: sasia×çmimi (${expected.toFixed(2)}) ≠ vlera rreshtit (${got.toFixed(2)}).`,
      );
    }
  }

  return {
    ok,
    lines_sum: roundedLines,
    invoice_total,
    warnings,
  };
}

async function callAnthropicVision({ mime, base64, prompt, maxTokens }) {
  const config = getAnthropicVisionConfig();
  if (!config.ready) {
    throw new Error("Skanimi i faturës kërkon ANTHROPIC_API_KEY në environment.");
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens || config.maxTokens,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mime,
                data: base64,
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || `Anthropic Vision gabim (${res.status})`);
  }

  const text = (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  const tokensUsed =
    Number(data.usage?.input_tokens || 0) + Number(data.usage?.output_tokens || 0);

  return { text, tokensUsed, model: config.model };
}

/**
 * Lexon faturën e furnizuesit. Ruajtja në stok vetëm pasi pronari shtyp «Regjistro».
 */
async function scanInvoiceFromImage({ mime, base64 }) {
  if (isAiPaused()) {
    throw new Error("AI është i ndalur për momentin. Provoni përsëri më vonë.");
  }
  if (!mime || !base64) {
    throw new Error("Mungon fotoja e faturës.");
  }

  const config = getAnthropicVisionConfig();
  const { text, tokensUsed, model } = await callAnthropicVision({
    mime,
    base64,
    prompt: EXTRACT_PROMPT,
    maxTokens: config.maxTokens,
  });

  const payload = extractJsonPayload(text);
  const items = normalizeInvoiceItems(payload.items ?? payload.lines ?? payload.artikuj ?? payload);

  if (!items.length) {
    throw new Error("Nuk u gjetën artikuj në foto. Provoni një foto më të qartë të faturës së furnizuesit.");
  }

  const invoiceTotal = parseNumber(
    payload.total_with_vat ?? payload.total ?? payload.grand_total ?? payload.totali,
  );
  const headerVat = normalizeScanVatRate(
    payload.vat_rate ?? payload.tvsh_percent ?? payload.tax_rate ?? payload.tatimi ?? 18,
  );
  const totals_check = buildTotalsCheck(items, invoiceTotal, headerVat);

  return {
    document_type: "stock_purchase",
    supplier: String(payload.supplier ?? payload.furnizues ?? payload.vendor ?? "").trim(),
    supplier_nui: normalizeSupplierNui(
      payload.supplier_nui ?? payload.nui ?? payload.nr_fiskal ?? payload.fiscal_number ?? "",
    ),
    supplier_vat: String(payload.supplier_vat ?? payload.nr_tvsh ?? payload.vat_number ?? "")
      .trim()
      .slice(0, 64),
    vat_rate: normalizeScanVatRate(
      payload.vat_rate ?? payload.tvsh_percent ?? payload.tax_rate ?? payload.tatimi ?? 18,
    ),
    purchase_kind: "goods",
    invoice_number: String(
      payload.invoice_number ?? payload.invoice_no ?? payload.nr_fature ?? payload.number ?? "",
    ).trim(),
    invoice_date: String(payload.invoice_date ?? payload.date ?? payload.data ?? "")
      .trim()
      .slice(0, 10),
    items,
    totals_check,
    warnings: totals_check.warnings || [],
    tokensUsed,
    model,
    provider: "anthropic",
  };
}

module.exports = {
  scanInvoiceFromImage,
  normalizeInvoiceItems,
  buildTotalsCheck,
  inferPiecesPerPack,
  normalizeUnit,
};
