/**
 * Shkarkon foto REALE (JPEG) për shërbimet e hotelit — lokale offline.
 * Përdorimi: node scripts/download-service-stock-photos.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "HOTEL", "public", "service-stock");

const UA = "Mozilla/5.0 (compatible; RevolutionHOTEL/1.0)";
const U = (id) => `https://images.unsplash.com/${id}?w=640&h=480&fit=crop&q=85&auto=format`;
const P = (id) => `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=640&h=480&fit=crop`;

/** Skedar → URL burim (foto reale të verifikuara). */
const FILES = {
  "bazen.jpg": U("photo-1576013551627-0cc20b96c2a7"),
  "sauna.jpg": U("photo-1540555700478-4be289fbecef"),
  "xhakuzi.jpg": U("photo-1584622650111-993a426fbf0a"),
  "gym.jpg": U("photo-1534438327276-14e5300c3a48"),
  "masazh.jpg": U("photo-1544161515-4ab6ce6db874"),
  "facial.jpg": U("photo-1570172619644-dfd03ed5d881"),
  "manikyr.jpg": U("photo-1604654894610-df63bc536371"),
  "pedikyr.jpg": U("photo-1519014816548-bf5fe059798b"),
  "minibar.jpg": U("photo-1566073771259-6a8506099945"),
  "room-service.jpg": U("photo-1414235077428-338989a2e8c0"),
  "shtrat-shtese.jpg": U("photo-1631049307264-da0ec9d70304"),
  "zgjatje-qendrimi.jpg": U("photo-1551882547-ff40c63fe5fa"),
  "laundry.jpg": U("photo-1517677208171-0bc6725a3e60"),
  "hekurosje.jpg": U("photo-1582735689369-4fe89db7114c"),
  "pastrim-thate.jpg": U("photo-1488459716781-31db52582fe9"),
  "parking.jpg": U("photo-1506521781263-d8422e82f27a"),
  "transfer-aeroport.jpg": U("photo-1436491865332-7a61a109cc05"),
  "marrje-veture.jpg": U("photo-1449824913935-59a10b8d2000"),
  "wifi.jpg": U("photo-1516321318423-f06f85e504b3"),
  "late-checkout.jpg": U("photo-1520250497591-112f2f40a3f4"),
  "early-checkin.jpg": U("photo-1564501049412-61c2a3083791"),
  "cat-rekreacion.jpg": U("photo-1576013551627-0cc20b96c2a7"),
  "cat-wellness.jpg": U("photo-1540555700478-4be289fbecef"),
  "cat-dhome.jpg": U("photo-1631049307264-da0ec9d70304"),
  "cat-pastrim.jpg": U("photo-1517677208171-0bc6725a3e60"),
  "cat-transport.jpg": U("photo-1506521781263-d8422e82f27a"),
  "cat-te-tjera.jpg": U("photo-1566073771259-6a8506099945"),
};

function fetchBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": UA, Accept: "image/*" } }, (res) => {
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
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  let ok = 0;
  let fail = 0;
  for (const [file, url] of Object.entries(FILES)) {
    process.stdout.write(`  ${file} ... `);
    try {
      const buf = await fetchBuffer(url);
      if (buf.length < 800) throw new Error("skedar shumë i vogël");
      fs.writeFileSync(path.join(outDir, file), buf);
      console.log(`OK (${Math.round(buf.length / 1024)} KB)`);
      ok++;
    } catch (err) {
      console.log("DËSHTOI:", err.message);
      fail++;
    }
  }
  console.log(`\n${ok} foto reale OK, ${fail} dështuan → ${outDir}\n`);
  if (fail) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
