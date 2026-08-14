const { getAnthropicVisionConfig } = require("../lib/aiVisionConfig");
const { isAiPaused } = require("../lib/aiConfig");

/**
 * Skanim fature BLERJEJE (Blerjet → kontrollo → Regjistro → stok).
 * Formati tipik KS (DISKONT DESAR etj.): Njesia=copë, Sasia=copa, Cmimi=çmim/copë.
 * Mos e trajto si pako×24 nëse fatura thotë copë.
 */
const EXTRACT_PROMPT =
  "Lexo këtë Faturë Shitje të FURNIZUESIT (p.sh. DISKONT DESAR) drejtuar kafenesë/restorantit (blerësi).\n" +
  "Kolonat tipike: Nr | Barkodi | Pershkrimi | Njesia | Sasia | Cmimi | Rabati | Tatimi | Vlera Pa TVSH | TVSH | Vlera Me TVSH.\n" +
  "RREGULLA KRITIKE:\n" +
  "1) Lexo Njesia SAKTËSISHT nga fatura. Nëse shkruan «copë» / «cope» → unit=\"copë\". Vetëm nëse shkruan «Pako»/«Pakë» → unit=\"pako\".\n" +
  "2) quantity = kolonën Sasia (numri siç duket: 40.00 → 40). MOS e shumëzo, MOS e ndaj.\n" +
  "3) unit_price = kolonën Cmimi (çmimi për 1 njësi: 1 copë ose 1 pako). JO «Vlera Me TVSH».\n" +
  "4) line_total = kolonën «Vlera Me TVSH» e atij rreshti.\n" +
  "5) pieces_per_pack: nëse unit=\"copë\" → GJITHMONË 1. Nëse unit=\"pako\" → sa copë ka 1 pako (nga emri «24 cop» ose 24 për pije).\n" +
  "6) name = Pershkrimi SAKTËSISHT si në faturë (p.sh. Ujë Mineral 0.50l, Coca-Cola 0.25l).\n" +
  "7) MOS invento rreshta. MOS përfshi TVSH/total/subtotal si artikull.\n" +
  "8) supplier = emri i firmës së sipërme (DISKONT…), JO emri i kafenesë blerëse.\n" +
  "9) supplier_nui = NUI / Nr. unik identifikues / Nr. biznesi i FURNIZUESIT (vetëm shifra, p.sh. 810xxxxxx). JO NUI i blerësit.\n" +
  "10) supplier_vat = Nr. TVSH i furnizuesit nëse duket (p.sh. XK…). Nëse nuk ka → \"\".\n" +
  "11) vat_rate = norma dominante e TVSH në faturë: 18, 8 ose 0. Nga kolona Tatimi / % TVSH / totalet. Nëse e paqartë → 18.\n" +
  "invoice_number (p.sh. 2024-400), invoice_date YYYY-MM-DD, total_with_vat = «Vlera për pagesë».\n" +
  "Përgjigju VETËM me JSON (pa markdown):\n" +
  '{"supplier":"DISKONT DESAR SH.P.K.","supplier_nui":"810123456","supplier_vat":"","vat_rate":18,"invoice_number":"2024-400","invoice_date":"2024-05-13","total_with_vat":277.72,"items":[{"name":"Ujë Mineral 0.50l","quantity":20,"unit":"copë","unit_price":0.25,"line_total":5.90,"pieces_per_pack":1},{"name":"Coca-Cola 0.25l","quantity":2,"unit":"copë","unit_price":0.60,"line_total":1.42,"pieces_per_pack":1}]}';

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
      entry?.unit_price ?? entry?.price ?? entry?.cmimi ?? entry?.cost ?? entry?.unit_cost,
    );
    if (quantity == null || quantity <= 0) continue;

    const pieces_per_pack = inferPiecesPerPack(
      name,
      unit,
      entry?.pieces_per_pack ?? entry?.copa_ne_pako ?? entry?.pieces,
    );
    const line_total = parseNumber(entry?.line_total ?? entry?.vlera ?? entry?.value);

    const key = `${name.toLowerCase()}|${quantity}|${unit}|${pieces_per_pack}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      name,
      quantity,
      unit,
      unit_price: unit_price != null && unit_price >= 0 ? unit_price : 0,
      pieces_per_pack,
      ...(line_total != null && line_total >= 0 ? { line_total } : {}),
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

function buildTotalsCheck(items, invoiceTotal) {
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
    const expected = Math.round(it.quantity * it.unit_price * 100) / 100;
    const got = Math.round(it.line_total * 100) / 100;
    if (Math.abs(expected - got) > Math.max(0.3, expected * 0.15)) {
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
  const totals_check = buildTotalsCheck(items, invoiceTotal);

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
