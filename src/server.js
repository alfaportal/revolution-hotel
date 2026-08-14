require("./lib/env");

const fs = require("fs");
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const { createProxyMiddleware, fixRequestBody } = require("http-proxy-middleware");

const { logEnvStatus } = require("./lib/env");
const { formatError } = require("./lib/errors");
const {
  corsMiddleware,
  requestLogger,
  jsonErrorHandler,
  noCachePanel,
} = require("./lib/http");
const { testSupabaseConnection } = require("./db");
const authRoutes = require("./routes/auth");
const licenseRoutes = require("./routes/license");
const salesRoutes = require("./routes/sales");
const adminRoutes = require("./routes/admin");
const superRoutes = require("./routes/super");
const ownerRoutes = require("./routes/owner");
const kdsRoutes = require("./routes/kds");
const waiterRoutes = require("./routes/waiter");
const kioskRoutes = require("./routes/kiosk");
const tableMenuRoutes = require("./routes/tableMenu");
const posRoutes = require("./routes/pos");
const receiptRoutes = require("./routes/receipt");
const fiscalRoutes = require("./routes/fiscal");
const aiRoutes = require("./routes/ai");
const { apiRouter: publicApiRouter, manifestHandler, serviceWorkerHandler } = require("./routes/public");
const {
  apiRouter: shopApiRouter,
  shopManifestHandler,
  shopServiceWorkerHandler,
} = require("./routes/shop");
const { resolvePublicClient } = require("./middleware/publicAuth");
const { ensureSuperAdmin } = require("./services/licenseService");
const { startLicenseExpiryCron } = require("./jobs/expireLicenses");
const { startRefusedOrdersExpiryJob } = require("./jobs/expireRefusedOrders");
const { startTrialNotificationCron } = require("./jobs/trialNotifications");
const { startOfflineNotificationCron } = require("./jobs/offlineNotifications");
const { startAiDailyReportCron } = require("./jobs/aiDailyReports");
const { startAiWeeklyReportCron } = require("./jobs/aiWeeklyReports");
const { startSupplySuggestionCron } = require("./jobs/supplySuggestions");
const { startNotificationDailyCron } = require("./jobs/notificationDailyReports");
const { startCloudHealthMonitor } = require("./jobs/cloudHealthMonitor");
const { startWeeklyDataExportCron } = require("./jobs/weeklyDataExport");
const { startTelegramBotWebhook } = require("./jobs/telegramBotWebhook");
const telegramRoutes = require("./routes/telegram");
const systemRoutes = require("./routes/system");
const { router: paymentsRouter, stripeWebhookHandler } = require("./routes/payments");
const {
  getPublicAppConfig,
  getPublicAppOrigin,
} = require("./lib/publicOrigin");
const { adminPanelPath } = require("./lib/admin-path");
const { paymentsConfigured } = require("./lib/stripeConfig");
const seoRoutes = require("./routes/seo");
const { asyncHandler } = require("./lib/asyncHandler");
const {
  renderPublicStorefrontHtml,
  renderNotFoundHtml,
} = require("./services/seoPublicPageHtml");
const { renderMarketingHtml } = require("./services/seoMarketingHtml");

/** SecureTrack (Security) — proxy për revolution-pos.com/security/* */
const SECURITY_UPSTREAM =
  process.env.SECURITY_UPSTREAM_URL ||
  "https://revolution-security-production.up.railway.app";

const pkg = require("../package.json");
const ADMIN_PATH = adminPanelPath();

const app = express();
const PORT = Number(process.env.PORT) || 8080;

app.set("trust proxy", 1);

app.use(corsMiddleware);

// Stripe webhook — RAW body (para express.json)
app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    void stripeWebhookHandler(req, res);
  },
);

/**
 * SecureTrack — reverse proxy (URL mbetet revolution-pos.com/security).
 * DUHET para express.json(): përndryshe body-parser e konsumon trupin e POST-it
 * dhe kërkesa e përcjellë mbetet varur pa përgjigje (hyrje/regjistrim/kod emaili).
 */
app.use(
  "/security",
  createProxyMiddleware({
    target: SECURITY_UPSTREAM,
    changeOrigin: true,
    pathRewrite: {
      "^/security$": "/",
      "^/security/": "/",
    },
    xfwd: true,
    proxyTimeout: 30_000,
    timeout: 30_000,
    on: {
      proxyReq: fixRequestBody,
      error: (err, _req, res) => {
        console.error("[security-proxy]", err?.message || err);
        if (res && !res.headersSent && typeof res.status === "function") {
          res.status(502).json({
            ok: false,
            gabim: "SecureTrack nuk u përgjigj. Provoni përsëri.",
          });
        }
      },
    },
  }),
);

app.use(express.json({ limit: "12mb" }));
app.use(jsonErrorHandler);
app.use(cookieParser());
app.use(requestLogger);
app.use(noCachePanel);

/** API private — mos indekso */
app.use("/api", (_req, res, next) => {
  res.set("X-Robots-Tag", "noindex, nofollow");
  next();
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "revolution-pos-server",
    version: pkg.version || "1.0.0",
    site_version: "2026-06-28-spotlight-v13",
    git_commit: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT || null,
    git_branch: process.env.RAILWAY_GIT_BRANCH || null,
    time: new Date().toISOString(),
    public_origin: getPublicAppOrigin(),
  });
});

app.get("/api/public/config", async (_req, res) => {
  try {
    const { ensureSetupReleaseMeta } = require("./lib/setupReleaseMeta");
    await ensureSetupReleaseMeta();
  } catch {
    /* fallback te cache/DEFAULT */
  }
  res.json({
    ok: true,
    ...getPublicAppConfig(),
    stripe_enabled: paymentsConfigured(),
  });
});

/**
 * SecureTrack → POS: dërgo kod rivendosjeje për pronarin Security (Resend).
 * Auth: i njëjti secret bridge (x-admin-secret).
 */
app.post("/api/public/security-owner-reset-mail", async (req, res) => {
  try {
    const SHARED = "naser-security-2026";
    const secrets = new Set(
      [
        process.env.SECURITY_ADMIN_SECRET,
        process.env.MASTER_ADMIN_BRIDGE_SECRET,
        process.env.SECURITY_SUPER_ADMIN_SECRET,
        SHARED,
      ]
        .map((s) => String(s || "").trim())
        .filter(Boolean),
    );
    const provided = String(req.get("x-admin-secret") || req.body?.secret || "").trim();
    if (!provided || !secrets.has(provided)) {
      return res.status(401).json({ ok: false, gabim: "Unauthorized", code: "ADMIN_AUTH" });
    }
    const email = String(req.body?.email || "").trim().toLowerCase();
    const code = String(req.body?.code || "").trim();
    if (!email || !code) {
      return res.status(400).json({ ok: false, gabim: "email dhe code janë të detyrueshme." });
    }
    const { sendOwnerPasswordResetEmail, isEmailConfigured } = require("./services/emailService");
    if (!isEmailConfigured()) {
      return res.status(503).json({
        ok: false,
        gabim: "Emaili nuk është i konfiguruar (RESEND_API_KEY).",
        code: "EMAIL_NOT_CONFIGURED",
      });
    }
    await sendOwnerPasswordResetEmail({ to: email, code });
    return res.json({ ok: true, email });
  } catch (e) {
    console.error("[security-owner-reset-mail]", e.message || e);
    return res.status(500).json({ ok: false, gabim: e.message || "Dërgimi dështoi" });
  }
});

/**
 * Kërkesë Setup link — email ose SMS (pa WhatsApp). Rate-limited.
 * Body: { channel: 'email'|'sms', email?, phone?, plan?, lang? }
 */
app.post("/api/public/setup-link-request", async (req, res) => {
  try {
    const { requestSetupLink } = require("./services/setupLinkRequestService");
    const ip =
      req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      "";
    const result = await requestSetupLink({
      channel: req.body?.channel,
      email: req.body?.email,
      phone: req.body?.phone || req.body?.telefon,
      plan: req.body?.plan,
      lang: req.body?.lang,
      ip,
    });
    res.json(result);
  } catch (e) {
    const code = e.code || "ERROR";
    const status =
      code === "RATE_LIMIT"
        ? 429
        : code === "SETUP_SECRET_MISSING" || code === "EMAIL_OFF" || code === "SMS_OFF"
          ? 503
          : 400;
    res.status(status).json({ ok: false, gabim: e.message, code });
  }
});

/**
 * Shkarkim Setup — publik (pa login).
 * Token opsional (?t=) për linkë admin.
 * Vetëm desktop/Windows — telefonët bllokohen.
 * Klienti sheh VETËM domain-in tonë (stream) — ASNJËHERË redirect te GitHub.
 */
app.get("/api/public/setup-download", async (req, res) => {
  const ua = String(req.headers["user-agent"] || "");
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
  if (isMobile) {
    res.set("Cache-Control", "no-store");
    const wantsHtml = String(req.headers.accept || "").includes("text/html");
    if (wantsHtml) {
      return res.status(403).type("html").send(`<!doctype html><html lang="sq"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Vetëm nga kompjuteri</title><style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:1.25rem;line-height:1.5;color:#111}a{color:#2563eb}</style></head><body><h1>Shkarkimi vetëm nga kompjuteri</h1><p>Setup i KAFENE shkarkohet vetëm nga Windows / kompjuteri. Nga telefoni nuk lejohet.</p><p><a href="/">← Kthehu te faqja</a></p></body></html>`);
    }
    return res.status(403).json({
      ok: false,
      gabim: "Shkarkimi i Setup funksionon vetëm nga kompjuteri (Windows). Nga telefoni nuk lejohet.",
      code: "DESKTOP_ONLY",
    });
  }
  const {
    verifySetupDownloadToken,
    isSetupDownloadConfigured,
  } = require("./lib/setupDownloadAuth");
  const {
    streamSetupInstaller,
    buildSameOriginDownloadPath,
    resolveSetupSource,
    SETUP_FILENAME,
  } = require("./lib/setupInstallerStream");
  const { getSetupVersion } = require("./lib/publicOrigin");

  let plan = String(req.query.plan || "").trim().toLowerCase();
  const token = String(req.query.t || req.query.token || "").trim();
  if (token) {
    if (!isSetupDownloadConfigured()) {
      return res.status(503).json({
        ok: false,
        gabim: "Shkarkimi i Setup kërkon SETUP_DOWNLOAD_SECRET në server.",
        code: "SETUP_SECRET_MISSING",
      });
    }
    const check = verifySetupDownloadToken(token);
    if (!check.ok) {
      return res.status(403).json({
        ok: false,
        gabim:
          check.reason === "expired"
            ? "Linku i shkarkimit ka skaduar. Shkarkoni përsëri nga revolution-pos.com."
            : "Linku i shkarkimit nuk është i vlefshëm.",
        code: "SETUP_TOKEN_INVALID",
      });
    }
    if (!plan && check.plan) plan = check.plan;
  }

  if (!resolveSetupSource(plan)) {
    return res.status(503).json({
      ok: false,
      gabim: "Setup nuk është i disponueshëm. Kontaktoni Revolution Invest.",
      code: "SETUP_URL_MISSING",
    });
  }

  res.set("Cache-Control", "no-store, no-cache, must-revalidate");

  const forceFile = String(req.query.dl || req.query.file || "") === "1";
  const accept = String(req.headers.accept || "");
  const wantsHtml =
    !forceFile && (accept.includes("text/html") || !accept.includes("application/json"));

  /* Faqe e thjeshtë instalimi — linku është GJITHMONË same-origin (jo GitHub) */
  if (wantsHtml) {
    const dlPath = buildSameOriginDownloadPath(req.query);
    const safeHref = dlPath.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const ver = getSetupVersion() || "";
    return res.type("html").send(`<!doctype html>
<html lang="sq">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta http-equiv="refresh" content="2;url=${safeHref}">
<title>Instalo Revolution POS</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:28rem;margin:3rem auto;padding:1.25rem;line-height:1.5;color:#111;text-align:center}
a.btn{display:inline-block;margin-top:1rem;padding:.9rem 1.35rem;background:#ea580c;color:#fff;text-decoration:none;border-radius:10px;font-weight:700}
p.hint{color:#555;font-size:.95rem}
</style>
</head>
<body>
<h1>Instalimi i Revolution POS</h1>
<p class="hint">Shkarkimi i instaluesit po fillon${ver ? ` (v${ver})` : ""}…</p>
<p class="hint">Pas shkarkimit hapni skedarin Setup dhe ndiqni hapat e instalimit.</p>
<p><a class="btn" id="dl" href="${safeHref}" download="${SETUP_FILENAME}">Shkarko instaluesin</a></p>
<script>
(function () {
  var u = ${JSON.stringify(dlPath)};
  function go() {
    try {
      var a = document.createElement("a");
      a.href = u;
      a.setAttribute("download", ${JSON.stringify(SETUP_FILENAME)});
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {}
    setTimeout(function () { window.location.replace(u); }, 800);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go);
  else go();
})();
</script>
</body>
</html>`);
  }

  try {
    const ok = await streamSetupInstaller(res, plan);
    if (!ok && !res.headersSent) {
      return res.status(503).json({
        ok: false,
        gabim: "Setup nuk është i disponueshëm. Kontaktoni Revolution Invest.",
        code: "SETUP_URL_MISSING",
      });
    }
  } catch (e) {
    if (res.headersSent) return;
    return res.status(502).json({
      ok: false,
      gabim: "Shkarkimi dështoi. Provoni përsëri ose kontaktoni Revolution Invest.",
      code: e.code || "SETUP_STREAM_FAILED",
    });
  }
});
/** Ndihmë AI për manualin publik — max 3 pyetje / sesion, përgjigje të shkurtra. */
app.get("/api/public/manual-help/status", (req, res) => {
  try {
    const { remainingFor, MAX_QUESTIONS } = require("./services/manualHelpService");
    const { isAiEnabled, isAiPaused } = require("./lib/aiConfig");
    const sessionId = String(req.query.session || "").trim();
    res.json({
      ok: true,
      enabled: isAiEnabled() && !isAiPaused(),
      remaining: remainingFor(sessionId),
      max: MAX_QUESTIONS,
    });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

app.post("/api/public/manual-help", async (req, res) => {
  try {
    const { askManualHelp } = require("./services/manualHelpService");
    const result = await askManualHelp({
      sessionId: req.body?.session || req.body?.sessionId,
      message: req.body?.message || req.body?.pyetje,
    });
    res.json(result);
  } catch (e) {
    const status = e.code === "LIMIT" ? 429 : e.code === "AI_OFF" ? 503 : 400;
    res.status(status).json({
      ok: false,
      gabim: e.message,
      code: e.code || null,
      remaining: e.remaining != null ? e.remaining : undefined,
    });
  }
});

app.use("/api/payments", paymentsRouter);

app.get("/health/db", async (_req, res) => {
  const result = await testSupabaseConnection();
  res.status(result.ok ? 200 : 503).json(result);
});

app.use("/api/auth", authRoutes);
app.use("/api/v1/license", licenseRoutes);
app.use("/api/v1/sales", salesRoutes);
app.use("/api/v1/pos", posRoutes);
app.use("/api/v1/receipt", receiptRoutes);
app.use("/api/v1/fiscal", fiscalRoutes);
app.use("/api/v1/system", systemRoutes.router);
app.use("/api/telegram", telegramRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/super", superRoutes);
app.use("/api/owner", ownerRoutes);
app.use("/api/kds", kdsRoutes);
app.use("/api/waiter", waiterRoutes);
app.use("/api/kiosk", kioskRoutes);
app.use("/api/menu", tableMenuRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/r", publicApiRouter);
app.use("/api/s", shopApiRouter);

app.get("/panel.html", (_req, res) => {
  res.status(404).type("text/plain").send("Not found");
});

app.use((req, res, next) => {
  if (/^\/(js\/panel\.js|css\/panel\.css)/.test(req.path)) {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  }
  next();
});

const PUBLIC_DIR = path.join(__dirname, "../public");
const SITE_DIR = path.join(PUBLIC_DIR, "site");

function sendMarketingPage(res, pathname) {
  res.set("Cache-Control", "public, max-age=120");
  res.type("html").send(renderMarketingHtml(pathname));
}

app.get("/", (_req, res) => sendMarketingPage(res, "/"));

app.get(
  [
    "/pse-ne",
    "/pse-ne/",
    "/si-ta-ngarkoni",
    "/si-ta-ngarkoni/",
    "/si-funksionon",
    "/si-funksionon/",
    "/pakot",
    "/pakot/",
    "/kontakt",
    "/kontakt/",
    "/pajisjet",
    "/pajisjet/",
    "/manuali",
    "/manuali/",
  ],
  (req, res) => {
    const clean = String(req.path || "").replace(/\/+$/, "") || "/";
    if (clean === "/manuali") {
      return res.redirect(301, "/website/manual.html");
    }
    sendMarketingPage(res, clean);
  },
);

app.get(["/blog", "/blog/"], (_req, res) => sendMarketingPage(res, "/blog"));

app.get("/blog/:slug", (req, res, next) => {
  if (req.params.slug.includes(".")) return next();
  sendMarketingPage(res, `/blog/${req.params.slug}`);
});

app.get("/privacy", (_req, res) => sendMarketingPage(res, "/privacy"));
app.get("/terms", (_req, res) => sendMarketingPage(res, "/terms"));

/** SEO — robots, sitemap, /restorante (para static) */
app.use(seoRoutes);

app.use(express.static(SITE_DIR));

app.use((req, res, next) => {
  if (req.path === "/js/waiter.js" || req.path === "/js/kitchen.js" || req.path === "/sw.js") {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  }
  next();
});

// Never serve the root waiter-manifest with start_url "/" or "/waiter/" —
// PWA install must use /waiter/:slug/manifest.json (injected in waiter.html).
app.get("/waiter-manifest.json", (_req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.status(404).type("application/manifest+json").json({
    error: "Use /waiter/:slug/manifest.json?key=...",
  });
});

app.use(express.static(PUBLIC_DIR));

/**
 * Master Admin i unifikuar: /admin (+ /admin/dashboard).
 * Rruga e vjetër sekrete (ADMIN_PANEL_PATH, p.sh. /ri-super) ridrejtohet këtu —
 * panel.html mbetet i arritshëm vetëm si /admin/legacy për raste emergjente.
 */
app.get(["/admin/dashboard", "/admin/dashboard/", "/admin", "/admin/"], (_req, res) => {
  if (_req.path === "/admin" || _req.path === "/admin/") {
    return res.redirect(302, "/admin/dashboard");
  }
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.sendFile(path.join(__dirname, "../public/admin/dashboard.html"));
});

app.get("/admin/legacy", (_req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.sendFile(path.join(__dirname, "../public/panel.html"));
});

/** Deprecuar: /ri-super (dhe ADMIN_PANEL_PATH) → Master Admin */
app.get(ADMIN_PATH, (_req, res) => {
  res.redirect(302, "/admin/dashboard");
});
if (ADMIN_PATH !== "/ri-super" && ADMIN_PATH !== "ri-super") {
  app.get(["/ri-super", "/ri-super/"], (_req, res) => {
    res.redirect(302, "/admin/dashboard");
  });
}

app.get("/panel", (_req, res) => {
  res.status(404).type("text/plain").send("Not found");
});

app.get("/owner/login", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/owner/login.html"));
});

app.get("/owner/setup", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/owner/setup.html"));
});

app.get("/owner/register", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/owner/register.html"));
});

app.get("/owner/panel", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/owner/panel.html"));
});

app.get("/bar/:slug", (_req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.sendFile(path.join(__dirname, "../public/bar.html"));
});

app.get("/kiosk/:slug", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/kiosk.html"));
});

app.get("/menu/:slug/:tableNumber", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/kiosk.html"));
});

app.get("/kitchen/:slug", (req, res) => {
  const token = String(req.query.w || "").trim();
  if (token) {
    const q = new URLSearchParams(req.query);
    return res.redirect(302, `/waiter/${encodeURIComponent(req.params.slug)}?${q.toString()}`);
  }
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.set("Pragma", "no-cache");
  res.sendFile(path.join(__dirname, "../public/kitchen.html"));
});

app.get("/waiter/:slug/manifest.json", (req, res) => {
  const slug = encodeURIComponent(String(req.params.slug || "").trim());
  const key = String(req.query.key || "").trim();
  const w = String(req.query.w || "").trim();
  const q = new URLSearchParams();
  if (key) q.set("key", key);
  if (w) q.set("w", w);
  const qs = q.toString();
  // Must include slug (+ key) — bare /waiter/ causes Express "Cannot GET /waiter/"
  const startUrl = `/waiter/${slug}${qs ? `?${qs}` : ""}`;
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.type("application/manifest+json");
  res.json({
    name: "Revolution Invest POS — Kamarieri",
    short_name: "Kamarieri",
    description: "Paneli i kamarierit — Revolution Invest POS",
    start_url: startUrl,
    scope: "/waiter/",
    display: "standalone",
    orientation: "portrait-primary",
    theme_color: "#0f1b3d",
    background_color: "#0f1b3d",
    icons: [
      {
        src: "/logo-source.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/logo-source.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
    ],
  });
});

app.get(["/waiter", "/waiter/"], (_req, res) => {
  res
    .status(404)
    .type("html")
    .send(`<!DOCTYPE html><html lang="sq"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kamarieri</title></head><body style="font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:1.5rem;line-height:1.5;text-align:center"><h1>Linku i kamarierit mungon</h1><p>Hapni linkun e plotë nga paneli i pronarit (me <code>/waiter/emri-lokalit?key=...</code>), pastaj shtojeni në ekranin kryesor.</p><p>Mos instaloni PWA nga faqja kryesore.</p></body></html>`);
});

app.get("/waiter/:slug", (req, res) => {
  const slug = String(req.params.slug || "").trim();
  const key = String(req.query.key || "").trim();
  const w = String(req.query.w || "").trim();
  const manQ = new URLSearchParams();
  if (key) manQ.set("key", key);
  if (w) manQ.set("w", w);
  const manifestHref = `/waiter/${encodeURIComponent(slug)}/manifest.json${
    manQ.toString() ? `?${manQ.toString()}` : ""
  }`;

  const filePath = path.join(__dirname, "../public/waiter.html");
  let html;
  try {
    html = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    console.error("[waiter] failed to read waiter.html:", formatError(err));
    return res.status(500).type("text").send("Gabim serveri.");
  }

  // Inject absolute manifest BEFORE the browser can race-fetch a wrong start_url
  html = html.replace(
    /<link\s+rel="manifest"[^>]*>/i,
    `<link rel="manifest" href="${manifestHref}">`,
  );

  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.type("html").send(html);
});

async function sendPublicStorefront(req, res, storefront, notFoundKind) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const result = await renderPublicStorefrontHtml({
      slug: req.params.slug,
      storefront,
    });
    if (!result.html) {
      return res.status(404).type("html").send(renderNotFoundHtml(notFoundKind));
    }
    return res.type("html").send(result.html);
  } catch (err) {
    if (err.code === "WRONG_STOREFRONT") {
      const other = storefront === "r" ? "s" : "r";
      return res.redirect(302, `/${other}/${encodeURIComponent(req.params.slug)}`);
    }
    if (err.code === "PACKAGE") {
      return res.status(404).type("html").send(renderNotFoundHtml(notFoundKind));
    }
    throw err;
  }
}

app.get("/r/:slug/manifest.json", manifestHandler);
app.get("/r/:slug/sw.js", resolvePublicClient, serviceWorkerHandler);
app.get("/r/:slug/order", (_req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.sendFile(path.join(__dirname, "../public/r-order.html"));
});
app.get(
  ["/r/:slug/menu", "/r/:slug/menu/"],
  asyncHandler((req, res) => sendPublicStorefront(req, res, "r", "restorant")),
);
app.get(
  "/r/:slug",
  asyncHandler((req, res) => sendPublicStorefront(req, res, "r", "restorant")),
);
app.get(
  ["/furra/:slug", "/furra/:slug/", "/hotel/:slug", "/hotel/:slug/"],
  asyncHandler((req, res) => sendPublicStorefront(req, res, "r", "restorant")),
);

app.get("/s/:slug/manifest.json", shopManifestHandler);
app.get("/s/:slug/sw.js", resolvePublicClient, shopServiceWorkerHandler);
app.get("/s/:slug/order", (_req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.sendFile(path.join(__dirname, "../public/s-order.html"));
});
app.get(
  "/s/:slug",
  asyncHandler(async (req, res) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    try {
      const result = await renderPublicStorefrontHtml({
        slug: req.params.slug,
        storefront: "s",
      });
      if (!result.html) {
        return res.status(404).type("html").send(renderNotFoundHtml("shop"));
      }
      return res.type("html").send(result.html);
    } catch (err) {
      if (err.code === "WRONG_STOREFRONT") {
        return res.redirect(302, `/r/${encodeURIComponent(req.params.slug)}`);
      }
      if (err.code === "PACKAGE") {
        return res.status(404).type("html").send(renderNotFoundHtml("shop"));
      }
      throw err;
    }
  }),
);

app.use((err, req, res, _next) => {
  console.error(`[error] ${req.method} ${req.originalUrl}:`, formatError(err));
  if (!res.headersSent) {
    res.status(500).json({ gabim: formatError(err) || "Gabim i brendshëm serveri." });
  }
});

async function start() {
  const envOk = logEnvStatus();
  if (!envOk) {
    console.warn("  ⚠️  Serveri niset por API-t që kërkojnë Supabase/JWT do të dështojnë.\n");
  }

  const dbCheck = await testSupabaseConnection();
  if (dbCheck.ok) {
    console.log("  ✅ Lidhja me Supabase: OK");
  } else {
    console.error("  ❌ Lidhja me Supabase dështoi:", dbCheck.error);
    if (dbCheck.hint) console.error("     Hint:", dbCheck.hint);
    if (dbCheck.details) console.error("     Details:", dbCheck.details);
  }

  try {
    await ensureSuperAdmin();
  } catch (e) {
    console.warn("  ⚠️  Super Admin seed:", formatError(e));
  }

  try {
    const { ensureInventorySchema } = require("./lib/ensureInventorySchema");
    const ok = await ensureInventorySchema();
    if (ok) {
      console.log("  ✅ Inventari (025): ingredients + menu_ingredients");
    } else {
      console.warn("  ⚠️  Inventari: vendosni DATABASE_URL në Railway për auto-migrim 025");
    }
  } catch (e) {
    console.warn("  ⚠️  Inventari schema:", formatError(e));
  }

  try {
    const { ensureShopSchema } = require("./lib/ensureShopSchema");
    const shopOk = await ensureShopSchema();
    if (shopOk) {
      console.log("  ✅ Dyqani (026): tipi dyqan + fusha produktesh");
    } else {
      console.warn("  ⚠️  Dyqani: vendosni DATABASE_URL në Railway për auto-migrim 026");
    }
  } catch (e) {
    console.warn("  ⚠️  Dyqani schema:", formatError(e));
  }

  try {
    const { ensureOrderAcceptanceSchema } = require("./lib/ensureOrderAcceptanceSchema");
    const accOk = await ensureOrderAcceptanceSchema();
    if (accOk) {
      console.log("  ✅ Porosi online (021): accepted_by_waiter_* kolonat");
    } else {
      console.warn("  ⚠️  Porosi online: vendosni DATABASE_URL për auto-migrim 021");
    }
  } catch (e) {
    console.warn("  ⚠️  Porosi online schema:", formatError(e));
  }

  try {
    const { ensureOrderRefusalSchema } = require("./lib/ensureOrderRefusalSchema");
    const refOk = await ensureOrderRefusalSchema();
    if (refOk) {
      console.log("  ✅ Refuzim porosie (040): refused_by + order_expires_at");
    } else {
      console.warn("  ⚠️  Refuzim porosie: vendosni DATABASE_URL për auto-migrim 040");
    }
  } catch (e) {
    console.warn("  ⚠️  Refuzim porosie schema:", formatError(e));
  }

  try {
    const { ensureLicenseHardwareSchema } = require("./lib/ensureLicenseHardwareSchema");
    const hwOk = await ensureLicenseHardwareSchema();
    if (hwOk) {
      console.log("  ✅ Licenca: hardware_id (16) kolonë");
    } else {
      console.warn("  ⚠️  Licenca hardware_id: vendosni DATABASE_URL për auto-migrim 058");
    }
  } catch (e) {
    console.warn("  ⚠️  Licenca hardware_id schema:", formatError(e));
  }

  startLicenseExpiryCron();
  startRefusedOrdersExpiryJob();
  startTrialNotificationCron();
  startOfflineNotificationCron();
  startAiDailyReportCron();
  startAiWeeklyReportCron();
  startSupplySuggestionCron();
  startNotificationDailyCron();
  startCloudHealthMonitor();
  startWeeklyDataExportCron();
  startTelegramBotWebhook();

  const publicOrigin = getPublicAppOrigin();
  console.log(`  🌐 Public URL:  ${publicOrigin}`);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n  🚀 Revolution POS Server — http://localhost:${PORT}`);
    console.log(`  📋 Master Admin: /admin/dashboard  (legacy ${ADMIN_PATH} → redirect)`);
    console.log(`  🏠 Website:     /  (revolution-pos.com)`);
    console.log(`  🔎 SEO:         /robots.txt  /sitemap.xml  /restorante`);
    console.log(`  🏪 Pronarët:    /owner/login`);
    console.log(`  🍹 Banak:       /bar/:slug?key=...  (porosi tavolinë/online/POS)`);
    console.log(`  🍳 Kuzhina KDS:  /kitchen/:slug?key=...  (ushqim)`);
    console.log(`  🧑‍🍳 Kamarieri:   /waiter/:slug?key=...`);
    console.log(`  🪑 Tavolinë:    /menu/:slug/:tableNumber  (QR publike)`);
    console.log(`  🪑 Kiosk vjetër: /kiosk/:slug?key=...&table=5`);
    console.log(`  🍽️  Restorant:   /r/:slug`);
    console.log(`  🛵 Porosi web:  /r/:slug/order`);
    console.log(`  🛍️  Dyqani:      /s/:slug`);
    console.log(`  📦 Porosi dyqan: /s/:slug/order`);
    console.log(`  📋 POS catalog:  GET /api/v1/pos/catalog  POST /api/v1/pos/catalog/sync`);
    console.log(`  🔑 License API: POST /api/v1/license/validate`);
    console.log(`  📊 Sales sync:  POST /api/v1/sales/sync`);
    console.log(`  🧾 Fiscal pay:  POST /api/v1/fiscal/pay`);
    console.log(`  📋 Z-Report:    GET /api/owner/z-report`);
    console.log(`  🤖 AI chat:     POST /api/ai/chat`);
    console.log(`  📷 AI menu:     POST /api/ai/scan-menu`);
    console.log(`  🧾 AI invoice:  POST /api/ai/scan-invoice`);
    console.log(`  📊 AI reports:  GET /api/owner/ai-reports`);
    console.log(`  🩺 Health DB:   GET /health/db\n`);
  });
}

start();
