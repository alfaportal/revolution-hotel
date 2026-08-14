#!/usr/bin/env node
/**
 * Kontrollo Setup para se të thuhet «gati / u publikua».
 * Dështon (exit 1) nëse burimi GitHub mungon, proxy dështon, ose klienti
 * do të shihte redirect te github.com.
 *
 * Përdorim:
 *   node scripts/verify-setup-download.mjs
 *   node scripts/verify-setup-download.mjs --url https://revolution-pos.com
 */
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const {
  DEFAULT_SETUP_DOWNLOAD_URL,
  DEFAULT_SETUP_VERSION,
  getSetupDownloadUrl,
  getSetupVersion,
  getPublicAppOrigin,
} = require("../src/lib/publicOrigin.js");
const { ensureSetupReleaseMeta } = require("../src/lib/setupReleaseMeta.js");

const args = process.argv.slice(2);
const originIdx = args.indexOf("--url");
const publicOrigin =
  (originIdx >= 0 && args[originIdx + 1]) ||
  process.env.VERIFY_PUBLIC_ORIGIN ||
  getPublicAppOrigin() ||
  "https://revolution-pos.com";

let failed = 0;
function ok(msg) {
  console.log(`  ✓ ${msg}`);
}
function fail(msg) {
  failed += 1;
  console.error(`  ✗ ${msg}`);
}

async function headOrGet(url, opts = {}) {
  const res = await fetch(url, {
    method: opts.method || "GET",
    redirect: opts.redirect || "manual",
    headers: opts.headers || {
      "User-Agent": "RevolutionPOS-SetupVerify/1.0",
      Accept: opts.accept || "*/*",
    },
  });
  return res;
}

async function main() {
  try {
    await ensureSetupReleaseMeta();
    ok("GitHub releases/latest u lexua (auto-publish)");
  } catch (e) {
    fail(`GitHub releases/latest: ${e.message}`);
  }

  const expectedVer = getSetupVersion() || DEFAULT_SETUP_VERSION;
  const sourceUrl = getSetupDownloadUrl() || DEFAULT_SETUP_DOWNLOAD_URL;
  const proxyHtml = `${publicOrigin.replace(/\/+$/, "")}/api/public/setup-download`;
  const proxyDl = `${proxyHtml}?dl=1`;

  console.log("\n[verify-setup] Kontroll Setup para publikimit");
  console.log(`  version: ${expectedVer}`);
  console.log(`  source:  ${sourceUrl}`);
  console.log(`  proxy:   ${proxyDl}\n`);

  if (!/KAFENE-Setup\.exe$/i.test(sourceUrl)) {
    fail("SETUP_DOWNLOAD_URL duhet të mbarojë me KAFENE-Setup.exe (burim intern)");
  } else {
    ok("Emri i burimit intern është KAFENE-Setup.exe");
  }

  if (!String(sourceUrl).includes(`setup-v${expectedVer}`) && !String(sourceUrl).includes(expectedVer)) {
    fail(`Version URL (${sourceUrl}) nuk përputhet me SETUP_VERSION=${expectedVer}`);
  } else {
    ok(`URL burimi përmban versionin ${expectedVer}`);
  }

  // 1) Burimi intern (GitHub) — duhet 200/302, jo 404
  try {
    const up = await headOrGet(sourceUrl, { method: "GET", redirect: "follow" });
    if (!up.ok) {
      fail(`Burimi intern HTTP ${up.status} — release/asset MUNGON (mos publiko!)`);
    } else {
      const len = up.headers.get("content-length");
      const buf = Buffer.from(await up.arrayBuffer());
      if (buf.length < 1_000_000) {
        fail(`Burimi intern shumë i vogël (${buf.length} bytes) — nuk është Setup`);
      } else if (buf[0] !== 0x4d || buf[1] !== 0x5a) {
        fail("Burimi intern nuk fillon me MZ (jo .exe Windows)");
      } else {
        globalThis.__setupSourceBytes = buf.length;
        ok(`Burimi intern OK (${buf.length} bytes${len ? `, CL=${len}` : ""}, MZ)`);
      }
    }
  } catch (e) {
    fail(`Burimi intern: ${e.message}`);
  }

  // 2) Faqja HTML same-origin
  try {
    const html = await headOrGet(proxyHtml, {
      accept: "text/html",
      redirect: "follow",
    });
    if (!html.ok) {
      fail(`Faqja setup-download HTTP ${html.status}`);
    } else {
      const text = await html.text();
      if (/github\.com\/.+\/releases/i.test(text)) {
        fail("Faqja HTML përmban link GitHub — e ndaluar për klient");
      } else if (!/Instalo|Shkarko|Revolution/i.test(text)) {
        fail("Faqja HTML nuk duket si faqja e instalimit");
      } else {
        ok("Faqja HTML same-origin OK (pa GitHub)");
      }
    }
  } catch (e) {
    fail(`Faqja HTML: ${e.message}`);
  }

  // 3) Proxy ?dl=1 — 200 + MZ + emër Revolution/KAFENE Setup
  try {
    const dl = await headOrGet(proxyDl, {
      accept: "application/octet-stream",
      redirect: "follow",
    });
    if (dl.status !== 200) {
      fail(`Proxy dl=1 HTTP ${dl.status} (pritët 200)`);
    } else {
      const cd = String(dl.headers.get("content-disposition") || "");
      const ct = String(dl.headers.get("content-type") || "");
      const loc = String(dl.headers.get("location") || "");
      if (/github\.com/i.test(loc)) {
        fail("Proxy redirect te GitHub — e ndaluar");
      }
      if (!/attachment/i.test(cd)) {
        fail(`Content-Disposition mungon attachment: ${cd || "(bosh)"}`);
      } else if (!/Revolution-POS-Setup|KAFENE-Setup/i.test(cd)) {
        fail(`Emri i shkarkimit i çuditshëm: ${cd}`);
      } else if (!cd.includes(expectedVer)) {
        fail(
          `Proxy ende shërben version të vjetër në emër: ${cd.slice(0, 140)} (pritët ${expectedVer}) — deploy mungon?`
        );
      } else {
        ok(`Content-Disposition OK: ${cd.slice(0, 120)}`);
      }
      // Lexo vetëm 2 MB për MZ (mos shkarko 116MB çdo herë)
      const reader = dl.body?.getReader?.();
      const chunks = [];
      let total = 0;
      const max = 2 * 1024 * 1024;
      if (reader) {
        while (total < max) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(Buffer.from(value));
          total += value.length;
        }
        try {
          reader.cancel();
        } catch {
          /* ignore */
        }
      }
      const head = Buffer.concat(chunks);
      const cl = Number(dl.headers.get("content-length") || 0);
      if (head[0] !== 0x4d || head[1] !== 0x5a) {
        fail(`Proxy nuk dërgon exe (fillimi=${head.slice(0, 8).toString("hex")}) — shpesh 502 JSON`);
      } else if (cl && cl < 1_000_000) {
        fail(`Content-Length shumë i vogël: ${cl}`);
      } else {
        ok(
          `Proxy stream OK (MZ, content-type=${ct || "?"}, content-length=${cl || "chunked"})`
        );
      }
      // Krahaso madhësinë me burimin (nëse e dimë nga hapi 1)
      if (globalThis.__setupSourceBytes && cl) {
        const srcLen = globalThis.__setupSourceBytes;
        const delta = Math.abs(cl - srcLen);
        if (delta > 2048) {
          fail(
            `Proxy Content-Length=${cl} ≠ burimi ${srcLen} (delta ${delta}) — version i gabuar në prod`
          );
        } else {
          ok(`Madhësia proxy përputhet me burimin (${cl} bytes)`);
        }
      }
    }
  } catch (e) {
    fail(`Proxy dl=1: ${e.message}`);
  }

  console.log("");
  if (failed) {
    console.error(`[verify-setup] DËSHTOI (${failed} gabime). MOS e shpall versionin publik.\n`);
    process.exit(1);
  }
  console.log("[verify-setup] ✓ Setup në rregull — mund të publikohet / të thuhet gati.\n");
  process.exit(0);
}

main().catch((e) => {
  console.error("[verify-setup] gabim:", e);
  process.exit(1);
});
