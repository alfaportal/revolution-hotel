/**
 * Shkarkon foto REALE (JPEG) për menunë — lokale offline.
 * Përdorimi: node scripts/download-menu-stock-photos.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const UA = "Mozilla/5.0 (compatible; RevolutionHOTEL/1.0)";

/** Unsplash slug → download (ndjek redirect). */
const S = slug => `https://unsplash.com/photos/${slug}/download?force=true&w=440&h=440&fit=crop`;
const U = id => `https://images.unsplash.com/${id}?w=440&h=440&fit=crop&q=85&auto=format`;
const P = id => `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=440&h=440&fit=crop`;

/** Skedar → URL burim (foto të z escuara nga përdoruesi + të verifikuara). */
const FILES = {
  "kafe-espresso.jpg": P("302899"),
  "kafe-me-qumesht.jpg": U("photo-1461023058943-07fcbe16d735"),
  "kapucino.jpg": U("photo-1572442388796-11668a67e53d"),
  "caj.jpg": S("eXw6CPGWwcg"),
  "neskafe.jpg": P("4109745"),
  "caj-i-ftohte.jpg": S("BIeXZhg_7sw"),
  "uje-05l.jpg": U("photo-1616118132534-381148898bb4"),
  "uje-15l.jpg": S("N-MqWXXZvNY"),
  "coca-cola.jpg": U("photo-1554866585-cd94860890b7"),
  "fanta.jpg": S("aKYu-H5pHJY"),
  "sprite.jpg": U("photo-1680404005217-a441afdefe83"),
  "lengu-frutash.jpg": U("photo-1600271886742-f049cd451bba"),
  "red-bull.jpg": S("KZQcIuo5sFU"),
  "ice-tea.jpg": S("BIeXZhg_7sw"),
  "baklava.jpg": S("AyFvqUm2fYw"),
  "tiramisu.jpg": P("6880219"),
  "akullore.jpg": U("photo-1563805042-7684c019e1cb"),
  "revani.jpg": P("291528"),
  "kroasan.jpg": U("photo-1555507036-ab1f4038808a"),
  "byrek-me-djathe.jpg": S("u5gSxngPiwg"),
  "sanduic.jpg": S("IZ0LRt1khgM"),
  "biskota.jpg": P("230325"),
  "chips.jpg": U("photo-1566478989037-eec170784d0b"),
  "kikirke.jpg": S("LYsjSweO3cM"),
};

function fetchBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": UA, Accept: "image/*" } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 10) {
          const next = new URL(res.headers.location, url).href;
          res.resume();
          return resolve(fetchBuffer(next, redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on("data", c => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

async function main() {
  const target = path.join(root, "HOTEL", "public", "menu-stock");
  fs.mkdirSync(target, { recursive: true });

  let ok = 0;
  let fail = 0;
  for (const [file, url] of Object.entries(FILES)) {
    process.stdout.write(`  ${file} ... `);
    try {
      const buf = await fetchBuffer(url);
      if (buf.length < 800) throw new Error("skedar shumë i vogël");
      fs.writeFileSync(path.join(target, file), buf);
      const svgPath = path.join(target, file.replace(/\.jpg$/, ".svg"));
      if (fs.existsSync(svgPath)) fs.unlinkSync(svgPath);
      console.log(`OK (${Math.round(buf.length / 1024)} KB)`);
      ok++;
    } catch (err) {
      console.log("DËSHTOI:", err.message);
      fail++;
    }
  }
  for (const f of fs.readdirSync(target)) {
    if (f.endsWith(".svg")) fs.unlinkSync(path.join(target, f));
  }
  console.log(`\n${ok} foto reale OK, ${fail} dështuan.\n`);
  if (fail) process.exitCode = 1;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
