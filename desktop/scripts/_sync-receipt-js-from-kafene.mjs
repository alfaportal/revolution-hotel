import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hotelAdmin = path.join(__dirname, "..", "public", "admin.html");
const kafeneAdmin = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "RESTAURANT",
  "restaurant-system",
  "KAFENE",
  "public",
  "admin.html",
);

const k = fs.readFileSync(kafeneAdmin, "utf8").split(/\r?\n/);
const receiptJs = k.slice(8712, 9299).join("\n");

const helpers = `
    function findMenuItemByNameFuzzy(name) {
      const target = String(name || "").trim().toLowerCase().replace(/\\s+/g, " ");
      if (!target) return null;
      for (const it of menuItemsCache || []) {
        if (String(it.name || "").trim().toLowerCase().replace(/\\s+/g, " ") === target) return it;
      }
      const tokens = target.split(/\\s+/).filter(Boolean);
      let best = null;
      let bestScore = 0;
      for (const it of menuItemsCache || []) {
        const n = String(it.name || "").trim().toLowerCase();
        if (!tokens.every((t) => n.includes(t))) continue;
        const score = tokens.join("").length;
        if (score > bestScore) {
          bestScore = score;
          best = it;
        }
      }
      return best;
    }

    async function suggestVatCategoryFromName(name, fallback) {
      const fb = String(fallback || "18");
      if (!window.VatSmartMapping) return fb;
      try {
        const vat = await VatSmartMapping.resolveVatFromName(name);
        if (vat && !vat.disputed && vat.rate != null) {
          return VatSmartMapping.letterToVatCategory(vat.letter, vat.rate);
        }
      } catch {
        /* ignore */
      }
      return fb;
    }
`;

let h = fs.readFileSync(hotelAdmin, "utf8");
const start = "    let receiptScanItems = [];";
const end = '    document.getElementById("btn-menu-scan-ai")?.addEventListener("click", openMenuScanModal);';
const a = h.indexOf(start);
const b = h.indexOf(end, a);
if (a < 0 || b < 0) {
  console.error("markers not found", a, b);
  process.exit(1);
}
h = h.slice(0, a) + helpers + receiptJs + "\n\n    " + h.slice(b);
fs.writeFileSync(hotelAdmin, h, "utf8");
console.log("Synced receipt scan JS into", hotelAdmin);
