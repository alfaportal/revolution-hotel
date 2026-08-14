#!/usr/bin/env node
/**
 * Test end-to-end Pako 4 (pako_5) — revolution-pos-server
 *
 * Env:
 *   BASE_URL=https://revolution-pos.com
 *   SUPER_TOKEN=...        (JWT super admin — opsionale)
 *   OWNER_TOKEN=...        (JWT client_admin BABYLON)
 *   LICENSE_KEY=...        (çelësi BABYLON — për /api/ai/status)
 *   CLIENT_NAME=BABYLON      (emri për kërkim në admin)
 *   DATABASE_URL=...       (Supabase/Postgres — verifikim DB)
 *   TEST_MENU_IMAGE=...    (path foto menu — opsionale)
 *   TEST_INVOICE_IMAGE=...  (path foto fature — opsionale)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = (process.env.BASE_URL || "https://revolution-pos.com").replace(/\/$/, "");
const CLIENT_NAME = (process.env.CLIENT_NAME || "BABYLON").trim();

const results = [];

function pass(name, detail = "") {
  results.push({ name, ok: true, detail });
  console.log(`✅ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, detail = "") {
  results.push({ name, ok: false, detail });
  console.error(`❌ ${name}${detail ? ` — ${detail}` : ""}`);
}

function skip(name, detail = "") {
  results.push({ name, ok: null, detail });
  console.log(`⏭️  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function api(pathname, { method = "GET", token, licenseKey, body, json = true } = {}) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (licenseKey) headers["X-License-Key"] = licenseKey;
  if (body != null) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  return { status: res.status, data };
}

function imageDataUrl(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`Mungon skedari: ${abs}`);
  const buf = fs.readFileSync(abs);
  const ext = path.extname(abs).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

async function verifyDb(clientId) {
  if (!process.env.DATABASE_URL) {
    skip("Supabase verify", "DATABASE_URL mungon");
    return;
  }
  const pg = await import("pg");
  const client = new pg.default.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const tier = await client.query(
      "SELECT package_tier FROM clients WHERE id = $1 OR emri ILIKE $2 LIMIT 1",
      [clientId || null, `%${CLIENT_NAME}%`],
    );
    if (tier.rows[0]?.package_tier === "pako_5") {
      pass("DB package_tier", `pako_5 për ${CLIENT_NAME}`);
    } else {
      fail("DB package_tier", tier.rows[0]?.package_tier || "klienti nuk u gjet");
    }

    const ing = await client.query(
      "SELECT COUNT(*)::int AS n FROM ingredients WHERE restaurant_id = $1",
      [clientId],
    );
    pass("DB ingredients", `${ing.rows[0]?.n ?? 0} rreshta`);

    const rep = await client.query(
      "SELECT report_date, LEFT(summary_text, 80) AS summary FROM ai_daily_reports WHERE restaurant_id = $1 ORDER BY report_date DESC LIMIT 3",
      [clientId],
    );
    if (rep.rows.length) {
      pass("DB ai_daily_reports", rep.rows.map(r => r.report_date).join(", "));
    } else {
      fail("DB ai_daily_reports", "asnjë raport");
    }
  } finally {
    await client.end();
  }
}

async function main() {
  console.log(`\n🧪 Pako 5 E2E — ${BASE}\n`);

  // 1. Deploy / health
  try {
    const health = await api("/health");
    if (health.data.ok) {
      pass("Health", `commit ${health.data.git_commit?.slice(0, 7) || "?"}`);
    } else fail("Health", JSON.stringify(health.data));
  } catch (e) {
    fail("Health", e.message);
  }

  // 2. AI status (license)
  const licenseKey = process.env.LICENSE_KEY?.trim();
  if (licenseKey) {
    const ai = await api("/api/ai/status", { licenseKey });
    if (ai.data.package_ai && ai.data.enabled) {
      pass("AI status (license)", "enabled + package_ai");
    } else if (ai.data.package_ai && !ai.data.enabled) {
      fail("AI status (license)", `package_ai OK por enabled=false (AI_PAUSED? configured=${ai.data.configured})`);
    } else {
      fail("AI status (license)", JSON.stringify(ai.data));
    }
  } else {
    skip("AI status (license)", "LICENSE_KEY mungon");
  }

  // 3. Admin — cakto pako_5 (manual ose SUPER_TOKEN)
  let clientId = process.env.CLIENT_ID?.trim() || "";
  if (process.env.SUPER_TOKEN) {
    const clients = await api("/api/admin/clients", { token: process.env.SUPER_TOKEN });
    if (clients.status === 200 && Array.isArray(clients.data.clients)) {
      const babylon = clients.data.clients.find(c =>
        String(c.emri || "").toUpperCase().includes(CLIENT_NAME.toUpperCase()),
      );
      if (babylon) {
        clientId = babylon.id;
        if (babylon.package_tier !== "pako_5") {
          const patch = await api(`/api/admin/clients/${babylon.id}`, {
            method: "PATCH",
            token: process.env.SUPER_TOKEN,
            body: { package_tier: "pako_5" },
          });
          if (patch.status < 400) pass("Admin tier → pako_5", babylon.emri);
          else fail("Admin tier patch", patch.data.gabim || patch.status);
        } else {
          pass("Admin tier", `${babylon.emri} tashmë pako_5`);
        }
      } else {
        fail("Admin find client", `Nuk u gjet ${CLIENT_NAME}`);
      }
    } else {
      fail("Admin clients list", clients.data.gabim || clients.status);
    }
  } else {
    skip("Admin tier BABYLON → pako_5", "SUPER_TOKEN mungon — bëje manual në /ri-super");
  }

  const ownerToken = process.env.OWNER_TOKEN?.trim();
  if (!ownerToken) {
    skip("Owner AI tabs / invoice / reports", "OWNER_TOKEN mungon");
    skip("Invoice scan API", "OWNER_TOKEN mungon");
    skip("AI report generate", "OWNER_TOKEN mungon");
  } else {
    const aiOwner = await api("/api/ai/status", { token: ownerToken });
    if (aiOwner.data.enabled && aiOwner.data.package_ai) {
      pass("Owner AI tabs gate", "enabled");
    } else {
      fail("Owner AI tabs gate", JSON.stringify(aiOwner.data));
    }

    if (process.env.TEST_INVOICE_IMAGE) {
      try {
        const photo = imageDataUrl(process.env.TEST_INVOICE_IMAGE);
        const scan = await api("/api/ai/scan-invoice", {
          method: "POST",
          token: ownerToken,
          body: { photo },
        });
        if (scan.status < 400 && scan.data.items?.length) {
          pass("Invoice scan", `${scan.data.items.length} artikuj`);
          const apply = await api("/api/owner/inventory/apply-invoice-scan", {
            method: "POST",
            token: ownerToken,
            body: {
              supplier: "Test E2E",
              invoice_number: `E2E-${Date.now()}`,
              items: scan.data.items.slice(0, 3).map(i => ({
                ...i,
                create_if_missing: true,
              })),
            },
          });
          if (apply.status < 400) pass("Invoice apply stock", `${apply.data.applied_count} artikuj`);
          else fail("Invoice apply stock", apply.data.gabim || apply.status);
        } else {
          fail("Invoice scan", scan.data.gabim || scan.status);
        }
      } catch (e) {
        fail("Invoice scan", e.message);
      }
    } else {
      skip("Invoice scan API", "TEST_INVOICE_IMAGE mungon");
    }

    const gen = await api("/api/owner/ai-reports/generate", {
      method: "POST",
      token: ownerToken,
      body: { send_email: true },
    });
    if (gen.status < 400 && gen.data.report?.summary_text) {
      pass("AI report generate", gen.data.skipped ? "ekzistonte" : "i ri");
      if (gen.data.report.email_sent_at) pass("Resend email flag", gen.data.report.email_sent_at);
      else skip("Resend email flag", "email_sent_at null — kontrollo RESEND + email pronari");
    } else {
      fail("AI report generate", gen.data.gabim || gen.status);
    }

    const list = await api("/api/owner/ai-reports", { token: ownerToken });
    if (list.status < 400 && list.data.reports?.length) {
      pass("AI reports list", `${list.data.reports.length} raporte`);
    } else {
      fail("AI reports list", list.data.gabim || "bosh");
    }
  }

  if (licenseKey && process.env.TEST_MENU_IMAGE) {
    try {
      const photo = imageDataUrl(process.env.TEST_MENU_IMAGE);
      const scan = await api("/api/ai/scan-menu", {
        method: "POST",
        licenseKey,
        body: { photo },
      });
      if (scan.status < 400 && scan.data.items?.length) {
        pass("Menu scan (cloud API)", `${scan.data.items.length} artikuj`);
      } else {
        fail("Menu scan (cloud API)", scan.data.gabim || scan.status);
      }
    } catch (e) {
      fail("Menu scan (cloud API)", e.message);
    }
  } else {
    skip("Menu scan cloud", "LICENSE_KEY ose TEST_MENU_IMAGE mungon");
  }

  if (clientId || ownerToken) {
    const id = clientId || (await api("/api/owner/client", { token: ownerToken })).data?.client?.id;
    if (id) await verifyDb(id);
  } else {
    skip("Supabase verify", "CLIENT_ID / OWNER_TOKEN mungon");
  }

  const failed = results.filter(r => r.ok === false).length;
  const passed = results.filter(r => r.ok === true).length;
  const skipped = results.filter(r => r.ok === null).length;
  console.log(`\n📊 ${passed} passed, ${failed} failed, ${skipped} skipped\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
