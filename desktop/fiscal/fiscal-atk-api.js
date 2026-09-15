/**
 * Dërgim PosCoupon te ATK (Faza e Testimit / PROD) — për E2E field 8.
 */
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { getFiscalSettings } = require("./fiscal-config");
const { encodePosCoupon } = require("./atk-model-builder");
const { signReceipt, loadPrivateKey, getKeysDir } = require("./fiscal-crypto");
const dbCrypto = require("../db-crypto");
const { atkDnsLookup } = require("./atk-dns");
const {
  isAtkTestMode,
  isAtkTransmissionBlocked,
  isFiscalMemoryOnly,
} = require("./fiscal-test-mode-store");
const { isAtkHost } = require("./fiscal-local-env");
const {
  isAtkCommunicationForbidden,
  blockAtkCommunicationResult,
} = require("./fiscal-atk-guard");

const TEST_BASE = "https://fiskalizimi-test.atk-ks.org";
const PROD_BASE = "https://fiskalizimi.atk-ks.org";
const ATK_HTTP_TIMEOUT_MS = Math.max(
  5000,
  Number(process.env.ATK_HTTP_TIMEOUT_MS) || 25000
);

function logAtkTestModePayload(receiptRow, payload) {
  console.log(
    "[fiscal-atk-api] ATK payload (console):",
    JSON.stringify({
      nuikf: receiptRow?.nuikf || null,
      url: payload.url || null,
    })
  );
}

function resolveAtkBaseUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return TEST_BASE;
  if (/prod|production/i.test(s) && !/^https?:/i.test(s)) return PROD_BASE;
  if (/test/i.test(s) && !/^https?:/i.test(s)) return TEST_BASE;
  return s.replace(/\/+$/, "");
}

function couponEndpoint(base) {
  const b = resolveAtkBaseUrl(base);
  if (/\/pos\/coupon\/?$/i.test(b)) return b;
  return `${b}/pos/coupon`;
}

function httpJsonPost(url, bodyObj, timeoutMs = ATK_HTTP_TIMEOUT_MS) {
  if (isAtkCommunicationForbidden()) {
    let host = "";
    try {
      host = new URL(String(url || "")).hostname;
    } catch {
      /* ignore */
    }
    if (!host || isAtkHost(host)) {
      return Promise.resolve({
        ok: false,
        forbidden: true,
        blocked: true,
        error: blockAtkCommunicationResult("httpJsonPost").error,
      });
    }
  }
  if (isAtkTransmissionBlocked() && isAtkHost(url)) {
    return Promise.resolve({
      ok: false,
      blocked: true,
      error: "ATK HTTP i bllokuar (FISCAL_LOCAL_RUN)",
      url: String(url),
    });
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      finish({ ok: false, error: "URL e pavlefshme: " + url });
      return;
    }
    const lib = parsed.protocol === "http:" ? http : https;
    const body = JSON.stringify(bodyObj);
    const req = lib.request(
      {
        hostname: parsed.hostname,
        servername: parsed.hostname,
        port: parsed.port || undefined,
        path: parsed.pathname + (parsed.search || ""),
        method: "POST",
        lookup: atkDnsLookup,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: timeoutMs,
        rejectUnauthorized: false,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => {
          data += c;
        });
        res.on("end", () => {
          const status = Number(res.statusCode) || 0;
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch {
            json = null;
          }
          finish({
            ok: status >= 200 && status < 300,
            status: status || null,
            body: data.slice(0, 4000),
            json,
          });
        });
        res.on("error", (e) => finish({ ok: false, error: e.message, status: res.statusCode || null }));
      }
    );
    req.on("error", (e) => finish({ ok: false, error: e.message }));
    req.on("timeout", () => {
      req.destroy();
      finish({ ok: false, error: "timeout (ATK nuk u përgjigj brenda " + timeoutMs + "ms)" });
    });
    req.write(body);
    req.end();
  });
}

function getAtkStatus() {
  const s = getFiscalSettings();
  const keysDir = getKeysDir();
  const privAtk = path.join(keysDir, "private-key.pem");
  const certAtk = path.join(keysDir, "signed-certificate.pem");
  const privLegacy = path.join(keysDir, "private.pem");
  const certLegacy = path.join(keysDir, "certificate.pem");
  const hasPrivate =
    dbCrypto.hasPrivateKeyMaterial(keysDir, s.private_key_path) ||
    fs.existsSync(privAtk) ||
    fs.existsSync(dbCrypto.encryptedPathFor(privAtk)) ||
    fs.existsSync(privLegacy) ||
    fs.existsSync(dbCrypto.encryptedPathFor(privLegacy));
  let certPath = "";
  if (fs.existsSync(certAtk)) certPath = certAtk;
  else if (s.certificate_path && fs.existsSync(s.certificate_path)) certPath = s.certificate_path;
  else if (fs.existsSync(certLegacy)) certPath = certLegacy;
  let certIsPlaceholder = true;
  if (certPath) {
    try {
      const txt = fs.readFileSync(certPath, "utf8");
      certIsPlaceholder =
        /PLACEHOLDER|Replace with ATK/i.test(txt) || !/BEGIN\s+CERTIFICATE/i.test(txt);
    } catch {
      /* */
    }
  }
  const base = resolveAtkBaseUrl(s.atk_api_url);
  const applicationId =
    s.application_id != null
      ? String(s.application_id)
      : s.application_id === undefined && s.sef_code
        ? String(s.sef_code)
        : "";
  return {
    fiscal_enabled: !!s.fiscal_enabled,
    fiscal_local_run: require("./fiscal-local-env").isFiscalLocalRun(),
    test_mode: isAtkTestMode(),
    atk_transmission_blocked: isAtkTransmissionBlocked(),
    fiscal_persistence: isFiscalMemoryOnly() ? "memory_only" : "sqlite",
    atk_base_url: base,
    atk_pos_coupon_url: couponEndpoint(base),
    environment: /fiskalizimi-test/i.test(base) ? "TEST" : /fiskalizimi\.atk/i.test(base) ? "PROD" : "CUSTOM",
    taxpayer_nui: s.taxpayer_nui || "",
    application_id: applicationId,
    keys_dir: keysDir,
    has_private_key: !!hasPrivate,
    certificate_path: certPath,
    certificate_is_placeholder: certIsPlaceholder,
    ready_for_atk:
      !!s.fiscal_enabled &&
      /^\d{9}$/.test(String(s.taxpayer_nui || "")) &&
      !!hasPrivate &&
      !certIsPlaceholder &&
      !!String(applicationId || "").trim(),
  };
}

async function sendPosCouponToAtk(receiptRow) {
  if (!receiptRow) return { sent: false, error: "mungon receipt" };

  if (isAtkCommunicationForbidden()) {
    return blockAtkCommunicationResult("sendPosCouponToAtk");
  }

  if (isAtkTransmissionBlocked()) {
    const settings = getFiscalSettings();
    const url = couponEndpoint(settings.atk_api_url);
    let protoBuf;
    try {
      protoBuf = encodePosCoupon(receiptRow, { settings });
    } catch (e) {
      return {
        sent: false,
        test_mode: true,
        blocked: true,
        error: "PosCoupon encode: " + e.message,
      };
    }
    const details = Buffer.from(protoBuf).toString("base64");
    let signature = "";
    try {
      signature = signReceipt(details) || "";
    } catch {
      /* */
    }
    logAtkTestModePayload(receiptRow, { details, signature, url });
    return {
      sent: false,
      test_mode: true,
      blocked: true,
      skipped: true,
      error: "ATK HTTP i bllokuar — vendosni FISCAL_LOCAL_RUN=0 për E2E",
      payload_logged: true,
      url,
    };
  }

  const settings = getFiscalSettings();
  if (!settings.fiscal_enabled) {
    return { sent: false, error: "fiscal OFF" };
  }

  const atkStatus = getAtkStatus();
  if (atkStatus.certificate_is_placeholder || !atkStatus.ready_for_atk) {
    return {
      sent: false,
      ready_to_send: false,
      error:
        "Certifikata ATK mungon ose është placeholder — vendos signed-certificate.pem nga onboarder ATK",
      atk: atkStatus,
    };
  }

  try {
    loadPrivateKey();
  } catch (e) {
    return { sent: false, error: "Çelësi privat: " + e.message };
  }

  const applicationId = settings.application_id || settings.sef_code || 0;
  const opts = {
    settings,
    businessId: settings.taxpayer_nui || receiptRow.taxpayer_nui,
    couponId: receiptRow.total_number || receiptRow.id,
    branchId: settings.unit_number || settings.business_unit_number || 1,
    applicationId,
  };

  let protoBuf;
  try {
    protoBuf = encodePosCoupon(receiptRow, opts);
  } catch (e) {
    return { sent: false, error: "PosCoupon encode: " + e.message };
  }

  const details = Buffer.from(protoBuf).toString("base64");
  let signature;
  try {
    signature = signReceipt(details);
  } catch (e) {
    return { sent: false, error: "Nënshkrimi: " + e.message };
  }
  if (!signature) {
    return { sent: false, error: "Nënshkrimi dështoi" };
  }

  const url = couponEndpoint(settings.atk_api_url);
  const body = { details, signature };
  const res = await httpJsonPost(url, body, ATK_HTTP_TIMEOUT_MS);
  if (!res.ok) {
    const errDetail =
      res.error ||
      (res.body ? String(res.body).slice(0, 200) : "") ||
      (res.status ? `HTTP ${res.status}` : "ATK nuk u përgjigj");
    return {
      sent: false,
      error: errDetail,
      status: res.status,
      body: res.body,
      url,
    };
  }

  return {
    sent: true,
    status: res.status,
    body: res.body,
    json: res.json,
    url,
    transaction_id: res.json?.transaction_id ?? res.json?.transactionId ?? null,
  };
}

module.exports = {
  TEST_BASE,
  PROD_BASE,
  resolveAtkBaseUrl,
  couponEndpoint,
  isAtkTestMode,
  getAtkStatus,
  sendPosCouponToAtk,
  httpJsonPost,
};
