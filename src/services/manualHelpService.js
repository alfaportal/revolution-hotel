/**
 * Ndihmë AI publike për faqen e manualit.
 * - Max 3 pyetje për sesion (browser)
 * - Përgjigje të shkurtra (max ~120 tokens)
 * - Vetëm nga përmbajtja e manualit (seksionet 3,4,9,11 + baza)
 */
const { getAiConfig, isAiPaused, isAiEnabled } = require("../lib/aiConfig");

const MAX_QUESTIONS = 3;
const MAX_MSG_LEN = 280;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** @type {Map<string, { count: number, at: number }>} */
const sessions = new Map();

const MANUAL_KB = `
MANUAL Revolution POS — përgjigju VETËM nga këto fakte. Shkurt (2–5 fjali). Shqip.

SEKSIONI 3 — KAMARIERI:
- Pronari shton kamarier me PIN 4-shifror te paneli → Kamarierët.
- Linku i telefonit: /waiter/[slug]?key=... (privat).
- Kamarieri hyn me PIN → zgjedh tavolinën → shton artikuj → «Dërgo porosinë».
- Porosia e kamarierit shkon DIREKT te banaku (PA Prano/Refuzo).
- Mbyllja: nga telefoni ose nga POS/paneli — UPDATE status closed, jo rresht i ri.
- Pas mbylljes: printohet fatura; tavolina bëhet e lirë.

SEKSIONI 4 — KIOSK / QR TAVOLINA:
- QR printohen nga paneli → Lokal & Stafi → QR Kodi i tavolinave.
- Klienti skanon QR → porosit nga telefoni → porosia shkon te banaku.
- Për porosi nga QR/takeaway: banaku mund të shohë Prano/Refuzo (jo për kamarier).
- Pagesa/fatura zakonisht në fund nga kamarieri ose kasa — kiosk vetëm merr porosinë.

SEKSIONI 9 — STOKU & BLERJET:
- Shitja zbrit stokun automatikisht për artikujt me ndjekje stoku.
- Blerje: POS Admin → Blerjet → «+ Faturë e re» (furnizues, NUI, TVSH%, artikuj) → Ruaj.
- Ose skano faturën me AI (foto) → kontrollo → Regjistro në Stok.
- Ose nga telefoni (panel pronari → Blerje) → POS e tërheq ~45s.
- Pas blerjes: stoku rritet VETË + faturë te Blerjet + libra te Kontabilisti.
- Nëse AI nuk lexon: mbush me dorë — mjafton; stoku dhe librat mbushen automatikisht.

SEKSIONI 11 — KONTABILISTI:
- POS Admin → Kontabilisti (hub).
- Shitjet e mbyllura → Libri i Shitjes TVSH automatikisht.
- Blerjet/shpenzimet → Libri i Blerjes TVSH automatikisht.
- Deklarata TVSH, Excel ATK, PDF ATK (formularë zyrtarë).
- Pagat dhe qera: i shkruan pronari me dorë (nuk vijnë nga shitja).
- Excel dhe PDF lexojnë të njëjtën databazë.

RREGULLA:
- Mos trillo. Nëse pyetja nuk është në manual, thuaj: «Shiko seksionin X në manual» ose kontaktoni +383 48707880.
- Mos jep këshilla juridike/fiskale të detajuara — udhëzo te Kontabilisti / kontabilisti i lokalit.
`.trim();

function pruneSessions() {
  const now = Date.now();
  for (const [k, v] of sessions) {
    if (now - v.at > SESSION_TTL_MS) sessions.delete(k);
  }
}

function getSessionState(sessionId) {
  pruneSessions();
  const id = String(sessionId || "").trim().slice(0, 64);
  if (!id || id.length < 8) {
    const err = new Error("Sesioni i pavlefshëm. Rifresko faqen.");
    err.code = "SESSION";
    throw err;
  }
  let row = sessions.get(id);
  if (!row) {
    row = { count: 0, at: Date.now() };
    sessions.set(id, row);
  }
  return { id, row };
}

function remainingFor(sessionId) {
  try {
    const { row } = getSessionState(sessionId);
    return Math.max(0, MAX_QUESTIONS - row.count);
  } catch {
    return MAX_QUESTIONS;
  }
}

async function askManualHelp({ sessionId, message }) {
  if (isAiPaused() || !isAiEnabled()) {
    const err = new Error("Ndihma AI është e padisponueshme për momentin. Lexoni manualin ose na kontaktoni.");
    err.code = "AI_OFF";
    throw err;
  }

  const text = String(message || "").trim();
  if (!text) throw new Error("Shkruani një pyetje.");
  if (text.length > MAX_MSG_LEN) throw new Error(`Pyetja max ${MAX_MSG_LEN} karaktere.`);

  const { id, row } = getSessionState(sessionId);
  if (row.count >= MAX_QUESTIONS) {
    const err = new Error(
      `Keni përdorur ${MAX_QUESTIONS} pyetje për sot. Lexoni seksionet 3, 4, 9 ose 11 në manual, ose na shkruani në WhatsApp.`,
    );
    err.code = "LIMIT";
    err.remaining = 0;
    throw err;
  }

  const config = getAiConfig();
  const system =
    MANUAL_KB +
    "\n\nPërgjigju shkurt. Max 5 fjali. Pa markdown të gjatë. Pa listë me shumë pika nëse mjafton 1–2 fjali.";

  let reply = "";
  let tokensUsed = 0;

  if (config.provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model.includes("mini") ? config.model : "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: text },
        ],
        max_tokens: 120,
        temperature: 0.2,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || `OpenAI gabim (${res.status})`);
    reply = String(data.choices?.[0]?.message?.content || "").trim();
    tokensUsed =
      Number(data.usage?.total_tokens) ||
      Number(data.usage?.prompt_tokens || 0) + Number(data.usage?.output_tokens || 0);
  } else if (config.provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 120,
        temperature: 0.2,
        system,
        messages: [{ role: "user", content: text }],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || `Anthropic gabim (${res.status})`);
    reply = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    tokensUsed =
      Number(data.usage?.input_tokens || 0) + Number(data.usage?.output_tokens || 0);
  } else {
    throw new Error("AI nuk është konfiguruar.");
  }

  if (!reply) throw new Error("AI nuk ktheu përgjigje.");

  row.count += 1;
  row.at = Date.now();
  sessions.set(id, row);

  return {
    ok: true,
    reply,
    remaining: Math.max(0, MAX_QUESTIONS - row.count),
    max: MAX_QUESTIONS,
    tokens_used: tokensUsed,
  };
}

module.exports = {
  askManualHelp,
  remainingFor,
  MAX_QUESTIONS,
};
