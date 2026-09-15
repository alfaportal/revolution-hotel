"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Emoji / simbolë të dyfishtë-koduar (UTF-8 → Latin-1/CP1252 → UTF-8).
 * Shkronjat shqipe tashmë janë OK — mos bëj latin1 mbi krejt skedarin.
 */
function fixEmojiMojibake(str) {
  // Zëvendësime të njohura nga manuali
  const pairs = [
    // 💡 Tip / Këshillë
    [/ðŸ’¡/g, "💡"],
    [/ðŸ\u2019¡/g, "💡"],
    // ⚠️ Warning / Kujdes (me ose pa variation selector)
    [/âš\s*ï¸?/g, "⚠️"],
    [/âš\u00A0ï¸/g, "⚠️"],
    [/âš ï¸/g, "⚠️"],
    [/âšï¸/g, "⚠️"],
    // 📱 Waiter / Kamarier
    [/ðŸ“±/g, "📱"],
    // 🪑 Table / Tavolinë (kiosk) — U+1FAA1
    [/ðŸª‘/g, "🪑"],
    // 🛵 Delivery
    [/ðŸ›µ/g, "🛵"],
    // 🥡 Takeaway
    [/ðŸ¥¡/g, "🥡"],
    // other common leftovers
    [/â†’/g, "→"],
    [/â†/g, "←"],
    [/â€”/g, "—"],
    [/â€“/g, "–"],
    [/â€™/g, "\u2019"],
    [/Â«/g, "«"],
    [/Â»/g, "»"],
    [/Â·/g, "·"],
    [/Â©/g, "©"],
  ];

  let out = str;
  for (const [re, rep] of pairs) out = out.replace(re, rep);

  // Fallback: çdo sekuencë tipike emoji mojibake (latin1-range chars) që fillon me ðŸ ose âš
  out = out.replace(/[\x80-\xff]{2,12}/g, (chunk) => {
    if (!/^[ðŸâšï¸“ª›¥’‘±µ¡\u00A0\s]+$/u.test(chunk) && !/^ðŸ/.test(chunk) && !/^âš/.test(chunk)) {
      return chunk;
    }
    try {
      if (![...chunk].every((c) => c.codePointAt(0) < 256)) return chunk;
      const fixed = Buffer.from(chunk, "latin1").toString("utf8");
      if (fixed.includes("\uFFFD")) return chunk;
      // vetëm nëse rezultati duket si emoji / simbol
      if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(fixed) || fixed.includes("⚠")) {
        return fixed;
      }
    } catch {
      /* keep */
    }
    return chunk;
  });

  return out;
}

function fallbackAlbanian(str) {
  return str
    .replace(/Ã«/g, "ë")
    .replace(/Ã§/g, "ç")
    .replace(/Ã‹/g, "Ë")
    .replace(/Ã‡/g, "Ç")
    .replace(/Ã©/g, "é")
    .replace(/Ã—/g, "×");
}

const root = path.join(__dirname, "..");
const files = [
  "public/website/manual.html",
  "public/website/manual-en-sections.js",
  "public/website/strings-manual-ui.js",
  "public/website/index.html",
];

for (const rel of files) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    console.log("skip", rel);
    continue;
  }
  let s = fs.readFileSync(p, "utf8");
  const before = (s.match(/ðŸ|âš|Ã.|â€/g) || []).length;
  s = fixEmojiMojibake(s);
  s = fallbackAlbanian(s);
  const after = (s.match(/ðŸ|âš|Ã.|â€/g) || []).length;
  fs.writeFileSync(p, s, "utf8");
  console.log(`${rel}: markers ${before} -> ${after}`);
  if (after > 0) {
    const re = /ðŸ.|âš.|Ã.|â€./g;
    let m;
    let n = 0;
    while ((m = re.exec(s)) && n < 6) {
      console.log("  leftover:", JSON.stringify(s.slice(Math.max(0, m.index - 5), m.index + 20)));
      n++;
    }
  }
}
