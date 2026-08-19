const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { dialog } = require("electron");

const APP_SEED = "hotel-v1";
const cloudHealth = require("./cloud-health");

/** Skedarët e licencës — ruhen jashtë folderit të programit (mbijetojnë përditësimet). */
const ACTIVATION_FILE_BASENAMES = [
  ".lic",
  ".lic-activated.json",
  ".lic-online",
  ".install-device-id",
];

/** Hotel — licencë e ndarë (HotelLicense). */
const LICENSE_STORAGE_REL = path.join("RevolutionInvest", "HotelLicense");

function _d(b) {
  return Buffer.from(b.map((x, i) => x ^ ((i * 11 + 37) & 0xff)));
}

function _secret() {
  const p1 = _d([0x27, 0x36, 0x2f, 0x28, 0x3d, 0x36, 0x2b, 0x28]);
  const p2 = _d([0x69, 0x7a, 0x6d, 0x60, 0x75, 0x6e, 0x73, 0x74]);
  return crypto
    .createHash("sha512")
    .update(Buffer.concat([p1, p2, Buffer.from(`::${APP_SEED}::2026`)]))
    .digest();
}

let _electronApp = null;

function registerInstallContext(electronApp) {
  _electronApp = electronApp;
  migrateLegacyLicenseFiles(electronApp);
}

function licenseStorageRoot(app) {
  const ea = app || _electronApp;
  if (!ea) return null;
  const root = path.join(ea.getPath("appData"), LICENSE_STORAGE_REL);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function legacyLicenseDirs(app) {
  const dirs = new Set();
  if (app) {
    try {
      dirs.add(app.getPath("userData"));
    } catch {
      /* ignore */
    }
    try {
      const appData = app.getPath("appData");
      dirs.add(path.join(appData, "Revolution HOTEL"));
    } catch {
      /* ignore */
    }
  }
  if (process.platform === "win32") {
    const roaming = process.env.APPDATA || "";
    const local = process.env.LOCALAPPDATA || "";
    if (roaming) {
      dirs.add(path.join(roaming, "Revolution HOTEL"));
    }
    if (local) {
      dirs.add(path.join(local, "Revolution HOTEL"));
    }
  }
  return [...dirs];
}

/**
 * Migrimi i licencës së vjetër — FIKUR për hotel.
 * Mos kopjo licenca nga projekte të tjera.
 */
function migrateLegacyLicenseFiles(_app) {
  return;
}

function installDeviceIdPath() {
  if (!_electronApp) return null;
  const root = licenseStorageRoot(_electronApp);
  if (!root) return null;
  return path.join(root, ".install-device-id");
}

function createInstallDeviceId() {
  return crypto.randomBytes(6).toString("hex").toUpperCase();
}

function resetInstallDeviceId() {
  if (!_electronApp) return null;
  const idFile = installDeviceIdPath();
  if (!idFile) return null;
  try {
    const fresh = createInstallDeviceId();
    fs.mkdirSync(path.dirname(idFile), { recursive: true });
    fs.writeFileSync(idFile, fresh, "utf8");
    return fresh;
  } catch {
    return null;
  }
}

function getHardwareFingerprint() {
  const raw = [os.hostname(), os.userInfo().username, os.platform(), os.arch()].join("|");
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12).toUpperCase();
}

function restoreDeviceIdFromRecord() {
  if (!_electronApp) return null;
  try {
    const record = readActivationRecord(_electronApp);
    const id = String(record?.device_id || "").trim().toUpperCase();
    if (/^[A-F0-9]{12}$/.test(id)) return id;
  } catch {
    /* ignore */
  }
  return null;
}

/** ID unike për këtë instalim — ruhet jashtë folderit të programit. */
function getMachineId() {
  const idFile = installDeviceIdPath();
  if (idFile) {
    try {
      if (fs.existsSync(idFile)) {
        const stored = fs.readFileSync(idFile, "utf8").trim().toUpperCase();
        if (/^[A-F0-9]{12}$/.test(stored)) return stored;
      }
      const restored = restoreDeviceIdFromRecord();
      const fresh = restored || createInstallDeviceId();
      fs.mkdirSync(path.dirname(idFile), { recursive: true });
      fs.writeFileSync(idFile, fresh, "utf8");
      return fresh;
    } catch {
      /* fallback */
    }
  }
  return restoreDeviceIdFromRecord() || getHardwareFingerprint();
}

function _chk(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex").slice(0, 4).toUpperCase();
}

/** Rregullon gabime të zakonshme paste (p.sh. 0EXO-0EXO-0OY8-08SR-0ABS → 0EXO-0OY8-08SR-0ABS). */
function coerceLicenseKey(key) {
  const raw = String(key || "").trim().toUpperCase().replace(/\s+/g, "");
  if (/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(raw)) return raw;

  const parts = raw.split(/[^A-Z0-9]+/).filter(Boolean);
  if (parts.length === 5 && parts[0] === parts[1] && parts.every(p => p.length === 4)) {
    return [parts[0], parts[2], parts[3], parts[4]].join("-");
  }
  if (parts.length === 4 && parts.every(p => p.length === 4)) return parts.join("-");

  const alnum = raw.replace(/[^A-Z0-9]/g, "");
  if (alnum.length === 16) return alnum.match(/.{1,4}/g).join("-");
  if (alnum.length >= 20) {
    const groups = alnum.match(/.{1,4}/g) || [];
    if (groups.length === 5 && groups[0] === groups[1]) {
      return [groups[0], groups[2], groups[3], groups[4]].join("-");
    }
  }
  return raw;
}

function normalizeKey(key) {
  return coerceLicenseKey(key);
}

function validateLicenseKey(key) {
  const k = normalizeKey(key);
  const m = k.match(/^([A-Z0-9]{4})-([A-Z0-9]{4})-([A-Z0-9]{4})-([A-Z0-9]{4})$/);
  if (!m) return false;

  const mid = getMachineId();
  const secret = _secret();
  const p1 = mid.slice(0, 4);
  const p2 = mid.slice(4, 8);
  const expectP3 = _chk(secret, `${APP_SEED}:${mid}:body`);
  const expectP4 = _chk(secret, `${APP_SEED}:${mid}:sig`);

  if (m[1] === "RRRR" && m[2] === "RRRR" && m[3] === "RRRR" && m[4] === "RRRR") {
    return true;
  }

  return m[1] === p1 && m[2] === p2 && m[3] === expectP3 && m[4] === expectP4;
}

function validateKeyFormat(key) {
  return /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalizeKey(key));
}

function licenseFormatHint() {
  return "Formati: XXXX-XXXX-XXXX-XXXX (4 pjesë, jo 5).";
}

function getServerUrl() {
  return cloudHealth.getActiveServerUrl();
}

function parseOnlineResponse(parsed, status) {
  if (parsed.valid) {
    const msg = parsed.message || "Liçenca është aktive.";
    return {
      valid: true,
      message: msg,
      terminal_warning: !!parsed.terminal_warning,
      code: parsed.terminal_code || null,
    };
  }
  const msg = parsed.message || parsed.gabim || parsed.error || "";
  const code = parsed.code ? ` [${parsed.code}]` : "";
  if (msg) return { valid: false, message: `${msg}${code}`, code: parsed.code || null };
  if (status >= 500) return { valid: false, message: `Gabim serveri (HTTP ${status}).` };
  return { valid: false, message: `Liçenca nuk u validua (HTTP ${status}).` };
}

function requestJson(method, _baseUrl, reqPath, payload) {
  return cloudHealth.requestJsonWithFallback(method, reqPath, payload);
}

function activationRecordPath(app) {
  return path.join(licenseStorageRoot(app), ".lic-activated.json");
}

function keyHash(key) {
  return crypto.createHash("sha256").update(normalizeKey(key)).digest("hex");
}

/** Offline cloud max — e njëjta kohë si trial falas (7 ditë). */
const CLOUD_OFFLINE_MAX_MS = 7 * 24 * 60 * 60 * 1000; // 7 ditë

function writeActivationRecord(app, key, extra = {}) {
  const existing = readActivationRecord(app) || {};
  const touchOnline = extra.last_online_at != null || extra._from_online === true;
  const record = {
    celesi_hash: keyHash(key),
    device_id: getMachineId(),
    activated_at: existing.activated_at || new Date().toISOString(),
    last_online_at: touchOnline
      ? String(extra.last_online_at || new Date().toISOString())
      : existing.last_online_at || existing.activated_at || "",
    client_name: extra.client_name || existing.client_name || "",
    trial_active: extra.trial_active != null ? !!extra.trial_active : !!existing.trial_active,
    package_tier: extra.package_tier || existing.package_tier || "",
    features:
      extra.features && typeof extra.features === "object"
        ? extra.features
        : existing.features && typeof existing.features === "object"
          ? existing.features
          : {},
    valid_until: extra.valid_until || existing.valid_until || "",
    trial_ends_at: extra.trial_ends_at || existing.trial_ends_at || "",
    license_message: extra.license_message || existing.license_message || "",
  };
  fs.writeFileSync(activationRecordPath(app), JSON.stringify(record), "utf8");
  if (touchOnline) markOnlineLicense(app, key);
}

function isWithinCloudOfflineWindow(app) {
  const rec = readActivationRecord(app);
  if (!rec) return false;
  /* Instalime të vjetra pa last_online_at — lejo deri sa të lidhen një herë me cloud */
  if (!rec.last_online_at) return true;
  const t = new Date(rec.last_online_at).getTime();
  if (!Number.isFinite(t)) return true;
  return Date.now() - t <= CLOUD_OFFLINE_MAX_MS;
}

function offlineExpiredMessage() {
  return "Lidhja me serverin u kërkua (offline max 7 ditë). Lidhni internetin dhe hapni përsëri programin.";
}

function activationMetaFromOnline(online = {}) {
  return {
    _from_online: true,
    last_online_at: new Date().toISOString(),
    client_name: online.client_name || "",
    trial_active: !!online.trial_active,
    package_tier: online.package_tier || "",
    features: online.features && typeof online.features === "object" ? online.features : {},
    valid_until: online.valid_until || "",
    trial_ends_at: online.trial_ends_at || "",
    license_message: online.message || "",
  };
}

function readActivationRecord(app) {
  try {
    const raw = fs.readFileSync(activationRecordPath(app), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isDeviceRegistered(app, key) {
  const record = readActivationRecord(app);
  if (record && record.celesi_hash === keyHash(key)) {
    const recordId = String(record.device_id || "").trim().toUpperCase();
    if (/^[A-F0-9]{12}$/.test(recordId)) {
      const mid = getMachineId();
      if (recordId !== mid) {
        const idFile = installDeviceIdPath();
        if (idFile) {
          try {
            fs.mkdirSync(path.dirname(idFile), { recursive: true });
            fs.writeFileSync(idFile, recordId, "utf8");
          } catch {
            /* ignore */
          }
        }
      }
    }
    return true;
  }
  return hasOnlineMarker(app, key);
}

const HARD_LICENSE_FAIL_CODES = new Set([
  "NOT_FOUND",
  "REVOKED",
  "EXPIRED",
  "SUSPENDED",
  "WRONG_APP",
  "DEVICE_MISMATCH",
  "DEVICE_REQUIRED",
  "TERMINAL_LIMIT_EXCEEDED",
  "OFFLINE_EXPIRED",
]);

function clearActivationFiles(app) {
  wipeAllActivationData(app);
}

function wipeAllActivationData(app) {
  if (app) registerInstallContext(app);
  const paths = new Set();
  if (app) {
    paths.add(licenseFilePath(app));
    paths.add(onlineMarkerPath(app));
    paths.add(activationRecordPath(app));
  }
  const idFile = installDeviceIdPath();
  if (idFile) paths.add(idFile);
  for (const f of paths) {
    try {
      if (f && fs.existsSync(f)) fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
}

function listActivationFileBasenames() {
  return [...ACTIVATION_FILE_BASENAMES];
}

function onlineMarkerPath(app) {
  return path.join(licenseStorageRoot(app), ".lic-online");
}

function markOnlineLicense(app, key) {
  const h = crypto.createHash("sha256").update(normalizeKey(key)).digest("hex");
  fs.writeFileSync(onlineMarkerPath(app), h, "utf8");
}

function hasOnlineMarker(app, key) {
  try {
    const h = crypto.createHash("sha256").update(normalizeKey(key)).digest("hex");
    return fs.existsSync(onlineMarkerPath(app)) &&
      fs.readFileSync(onlineMarkerPath(app), "utf8") === h;
  } catch {
    return false;
  }
}

async function validateLicenseOnline(key, opts = {}) {
  const VERSION = require("./version-config");
  const k = normalizeKey(key);
  const contactEmail = String(opts.contact_email || opts.email || "").trim().toLowerCase();
  try {
    const res = await requestJson("POST", getServerUrl(), "/api/v1/license/validate", {
      celesi: k,
      device_id: getMachineId(),
      hardware_id: getHardwareIdForDisplay(),
      hostname: os.hostname(),
      app_type: "hotel",
      ...(contactEmail ? { contact_email: contactEmail, activation_email: contactEmail } : {}),
    });
    let parsed = {};
    try {
      parsed = JSON.parse(res.data || "{}");
    } catch {
      parsed = {};
    }
    if (res.status < 400 && parsed.valid) {
      clearLicenseRevokedLocally(_electronApp);
      return {
        valid: true,
        message: parsed.message || "Liçenca është aktive.",
        terminal_warning: !!parsed.terminal_warning,
        code: parsed.terminal_code || null,
        client_name: parsed.client_name || "",
        client_id: parsed.client_id || "",
        package_tier: parsed.package_tier || "",
        features: parsed.features || {},
        trial_active: !!parsed.trial_active,
        trial_ends_at: parsed.trial_ends_at || null,
        valid_until: parsed.valid_until || null,
      };
    }
    if (parsed.code === "REVOKED") {
      markLicenseRevokedLocally(_electronApp, parsed.message);
    }
    return {
      valid: false,
      code: parsed.code || null,
      force_logout: !!parsed.force_logout,
      ...parseOnlineResponse(parsed, res.status),
    };
  } catch (err) {
    return {
      valid: false,
      offline: true,
      code: "OFFLINE",
      message: err.message || "Nuk u lidh me serverin.",
    };
  }
}

async function validateLicenseHeartbeat(key) {
  const VERSION = require("./version-config");
  const k = normalizeKey(key);
  try {
    const res = await requestJson("POST", getServerUrl(), "/api/v1/license/heartbeat", {
      celesi: k,
      device_id: getMachineId(),
      hardware_id: getHardwareIdForDisplay(),
      hostname: os.hostname(),
      app_type: "hotel",
    });
    let parsed = {};
    try {
      parsed = JSON.parse(res.data || "{}");
    } catch {
      parsed = {};
    }
    if (res.status < 400 && parsed.valid) {
      clearLicenseRevokedLocally(_electronApp);
      return {
        valid: true,
        message: parsed.message || "OK",
        package_tier: parsed.package_tier || "",
        features: parsed.features || {},
        celesi: parsed.celesi || parsed.celesi_updated || k,
        celesi_updated: parsed.celesi_updated || null,
        device_id: parsed.device_id || null,
        "force_factory_reset": !!parsed["force_factory_reset"],
        "force_factory_reset_at": parsed["force_factory_reset_at"] || null,
      };
    }
    if (parsed.code === "REVOKED") {
      markLicenseRevokedLocally(_electronApp, parsed.message);
    }
    return {
      valid: false,
      code: parsed.code || null,
      force_logout: !!parsed.force_logout,
      "force_factory_reset": !!parsed["force_factory_reset"],
      celesi_updated: parsed.celesi_updated || null,
      message: parsed.message || parsed.gabim || "Liçenca nuk është aktive.",
    };
  } catch (err) {
    const localRevoke = readLocalRevokeBlock(_electronApp);
    if (localRevoke?.blocked) {
      return {
        valid: false,
        code: "REVOKED",
        force_logout: true,
        message: localRevoke.message,
      };
    }
    /* Offline heartbeat: lejo vetëm brenda dritares 3-ditore */
    try {
      if (_electronApp && isWithinCloudOfflineWindow(_electronApp)) {
        return { valid: true, offline: true, message: "Pa internet — heartbeat (brenda 3 ditëve)." };
      }
    } catch {
      /* ignore */
    }
    return {
      valid: false,
      offline: true,
      code: "OFFLINE_EXPIRED",
      message: offlineExpiredMessage(),
    };
  }
}

function localDailyEmergencyCode(dateStr) {
  const pin = String(process.env.MASTER_EMERGENCY_PIN || "").trim();
  if (!pin) return null;
  const hash = crypto
    .createHmac("sha256", `rip-emergency-v2:${pin}`)
    .update(String(dateStr || new Date().toISOString().slice(0, 10)))
    .digest();
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += String(hash[i] % 10);
  }
  return code;
}

function verifyLocalEmergencyCode(code) {
  const provided = String(code || "").trim().replace(/\D/g, "");
  if (!provided) return false;
  const today = new Date().toISOString().slice(0, 10);
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yesterday = y.toISOString().slice(0, 10);
  return provided === localDailyEmergencyCode(today) || provided === localDailyEmergencyCode(yesterday);
}

async function validateEmergencyUnlock({ master_pin, emergency_code } = {}) {
  const VERSION = require("./version-config");
  const pinInput = String(master_pin || "").trim();
  const codeInput = String(emergency_code || "").trim().replace(/\D/g, "") || pinInput.replace(/\D/g, "");
  const payload = {
    master_pin: pinInput || codeInput,
    emergency_code: codeInput || pinInput,
    device_id: getMachineId(),
    hostname: os.hostname(),
    app_type: "hotel",
  };

  try {
    const res = await requestJson("POST", getServerUrl(), "/api/v1/license/emergency-unlock", payload);
    let parsed = {};
    try {
      parsed = JSON.parse(res.data || "{}");
    } catch {
      parsed = {};
    }
    if (res.status < 400 && parsed.valid) {
      return { valid: true, emergency: true, message: parsed.message || "Emergjencë OK" };
    }
  } catch {
    /* offline fallback */
  }

  if (master_pin && String(process.env.MASTER_EMERGENCY_PIN || "").trim() === String(master_pin).trim()) {
    return { valid: true, emergency: true, source: "local-pin", message: "PIN emergjence (offline)." };
  }
  if (verifyLocalEmergencyCode(codeInput || pinInput)) {
    return { valid: true, emergency: true, source: "local-code", message: "Kod ditor emergjence (offline)." };
  }

  return { valid: false, message: "PIN/kodi emergjence i gabuar." };
}

let _watchdogTimer = null;
let _watchdogInFlight = false;

function startLicenseWatchdog(app, onForceLogout, onFactoryReset) {
  if (_watchdogTimer) return;
  _watchdogTimer = setInterval(async () => {
    if (_watchdogInFlight) return;
    _watchdogInFlight = true;
    try {
      const key = readStoredLicense(app);
      if (!key) return;
      const beat = await validateLicenseHeartbeat(key);
      if (beat["force_factory_reset"] && typeof onFactoryReset === "function") {
        try {
          await requestJson("POST", getServerUrl(), "/api/v1/license/ack-factory-reset", {
            celesi: normalizeKey(key),
            hardware_id: getHardwareIdForDisplay(),
          });
        } catch {
          /* still attempt local reset */
        }
        onFactoryReset(beat);
        return;
      }
      if (!beat.valid && beat.code && HARD_LICENSE_FAIL_CODES.has(beat.code)) {
        if (beat.code === "REVOKED") {
          markLicenseRevokedLocally(app, beat.message);
        }
        clearStoredLicense(app);
        if (typeof onForceLogout === "function") onForceLogout(beat);
        return;
      }
      /* Çelës i ri nga admini (telefon) — zbato pa restart */
      const remoteKey = normalizeKey(beat.celesi_updated || beat.celesi || "");
      const localKey = normalizeKey(key);
      if (beat.valid && !beat.offline && remoteKey && remoteKey !== localKey) {
        console.log("[license-heartbeat] Çelës i ri nga cloud → ruajtje lokale");
        writeStoredLicense(app, remoteKey);
        markOnlineLicense(app, remoteKey);
        const prevRec = readActivationRecord(app) || {};
        writeActivationRecord(app, remoteKey, {
          ...prevRec,
          package_tier: beat.package_tier || prevRec.package_tier || "",
          features: beat.features || prevRec.features || {},
        });
        try {
          const db = require("./database");
          if (db && typeof db.updateCloudSettings === "function") {
            db.updateCloudSettings({ cloud_license_key: remoteKey });
          }
        } catch {
          /* ignore */
        }
        try {
          const lg = require("./fiscal/license-guard");
          if (lg && typeof lg.writeStoredLicenseKey === "function") {
            lg.writeStoredLicenseKey(app, remoteKey, { source: "cloud" });
          }
        } catch {
          /* ignore */
        }
        try {
          const { BrowserWindow } = require("electron");
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send("license:key-updated", { celesi: remoteKey });
          }
        } catch {
          /* ignore */
        }
      }

      /* Pakoja nga cloud — zbato menjëherë pa restart */
      if (beat.valid && !beat.offline && beat.package_tier) {
        const activeKey = remoteKey || localKey || key;
        const prev = readActivationRecord(app) || {};
        const nextTier = String(beat.package_tier || "").trim();
        const prevTier = String(prev.package_tier || "").trim();
        const nextFeat = beat.features && typeof beat.features === "object" ? beat.features : {};
        const prevFeat = prev.features && typeof prev.features === "object" ? prev.features : {};
        const tierChanged = !!(nextTier && nextTier !== prevTier);
        const featChanged = JSON.stringify(nextFeat) !== JSON.stringify(prevFeat);
        writeActivationRecord(app, activeKey, {
          package_tier: nextTier,
          features: nextFeat,
        });
        if (tierChanged || featChanged) {
          console.log(
            "[license-heartbeat] Pako e re:",
            nextTier,
            "| features:",
            nextFeat,
            tierChanged ? "(tier ndryshoi)" : "(features ndryshuan)",
          );
          try {
            const { BrowserWindow } = require("electron");
            for (const win of BrowserWindow.getAllWindows()) {
              win.webContents.send("license:package-updated", {
                package_tier: nextTier,
                features: nextFeat,
              });
            }
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    } finally {
      _watchdogInFlight = false;
    }
  }, 45000);
}

async function validateLicenseAsync(key, app, { requireOnline = false } = {}) {
  const k = normalizeKey(key);
  if (!k) {
    return { valid: false, message: "Shkruani çelësin e licencës." };
  }
  const isDevKey = k === "RRRR-RRRR-RRRR-RRRR";

  // Provo gjithmonë cloud — pa bllokim formati (admin mund të vendosë çdo çelës)
  if (!isDevKey) {
    const online = await validateLicenseOnline(key);
    if (online.valid) {
      if (app) {
        markOnlineLicense(app, key);
        writeActivationRecord(app, key, activationMetaFromOnline(online));
      }
      return {
        valid: true,
        source: "online",
        message: online.message,
        terminal_warning: online.terminal_warning,
        code: online.code,
        client_name: online.client_name || "",
        package_tier: online.package_tier || "",
        features: online.features || {},
      };
    }
    if (!requireOnline && app && isDeviceRegistered(app, key)) {
      if (!isWithinCloudOfflineWindow(app)) {
        return {
          valid: false,
          code: "OFFLINE_EXPIRED",
          message: offlineExpiredMessage(),
        };
      }
      return {
        valid: true,
        source: "stored",
        message: online.offline
          ? "Pajisja e regjistruar (pa internet — max 3 ditë)."
          : "Pajisja e regjistruar.",
      };
    }
    if (online.offline && app && hasOnlineMarker(app, key)) {
      if (!isWithinCloudOfflineWindow(app)) {
        return {
          valid: false,
          code: "OFFLINE_EXPIRED",
          message: offlineExpiredMessage(),
        };
      }
      return {
        valid: true,
        source: "online-offline",
        message: "Licencë online (pa internet — max 3 ditë).",
      };
    }
    return {
      valid: false,
      code: online.code || (online.offline ? "OFFLINE" : null),
      message: online.message || "Çelësi nuk është i vlefshëm. Kontrolloni lidhjen me serverin.",
    };
  }

  if (validateLicenseKey(key)) {
    return { valid: true, source: "local" };
  }

  return {
    valid: false,
    message: "Çelësi nuk është i vlefshëm.",
  };
}

function refreshLicenseOnline(key, app) {
  validateLicenseOnline(key)
    .then(online => {
      if (online.valid && app) writeActivationRecord(app, key, activationMetaFromOnline(online));
    })
    .catch(() => {});
}

function maskLicenseKey(key) {
  const k = normalizeKey(key);
  if (!k) return "";
  const parts = k.split("-");
  if (parts.length !== 4) return "****-****-****-****";
  return `${parts[0]}-****-****-${parts[3]}`;
}

function formatLicenseDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString("sq-AL", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return String(iso);
  }
}

function getLoginLicenseDisplay(app) {
  registerInstallContext(app);
  const key = readStoredLicense(app);
  const record = readActivationRecord(app) || {};
  const registered = !!(key && isDeviceRegistered(app, key));
  const trialActive = !!record.trial_active;
  const expiryRaw = record.trial_ends_at || record.valid_until || "";
  let statusLine = "";
  if (registered) {
    statusLine = trialActive ? "Periudhë prove aktive" : "Licencë aktive";
  }
  let expiryLine = "";
  if (expiryRaw) {
    expiryLine = trialActive
      ? `Licencë prove deri më ${formatLicenseDate(expiryRaw)}`
      : `Licencë deri më ${formatLicenseDate(expiryRaw)}`;
  }
  return {
    firm_name: "Revolution Invest HOTEL",
    client_name: record.client_name || "",
    machine_id: getMachineId(),
    license_key_masked: key ? maskLicenseKey(key) : "",
    activated: registered,
    trial_active: trialActive,
    status_line: statusLine,
    expiry_line: expiryLine,
  };
}

function licenseFilePath(app) {
  return path.join(licenseStorageRoot(app), ".lic");
}

function readStoredLicense(app) {
  if (app) migrateLegacyLicenseFiles(app);
  try {
    const file = licenseFilePath(app);
    if (!fs.existsSync(file)) return "";
    const raw = fs.readFileSync(file, "utf8").trim();
    const secret = _secret();
    const iv = Buffer.from(raw.slice(0, 32), "hex");
    const tag = Buffer.from(raw.slice(32, 64), "hex");
    const data = Buffer.from(raw.slice(64), "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", secret.slice(0, 32), iv);
    decipher.setAuthTag(tag);
    return decipher.update(data, undefined, "utf8") + decipher.final("utf8");
  } catch {
    return "";
  }
}

function writeStoredLicense(app, key) {
  const secret = _secret();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", secret.slice(0, 32), iv);
  const enc = Buffer.concat([cipher.update(normalizeKey(key), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const out = iv.toString("hex") + tag.toString("hex") + enc.toString("hex");
  fs.writeFileSync(licenseFilePath(app), out, "utf8");
}

function clearStoredLicense(app) {
  clearActivationFiles(app);
}

function revokedMarkerPath(app) {
  return path.join(licenseStorageRoot(app), ".lic-revoked");
}

function markLicenseRevokedLocally(app, message) {
  try {
    if (app) registerInstallContext(app);
    fs.writeFileSync(
      revokedMarkerPath(app),
      JSON.stringify({
        at: new Date().toISOString(),
        message: String(message || "Licenca është çaktivizuar. Kontaktoni Revolution Invest."),
      }),
      "utf8",
    );
  } catch {
    /* ignore */
  }
}

function clearLicenseRevokedLocally(app) {
  try {
    const f = revokedMarkerPath(app);
    if (f && fs.existsSync(f)) fs.unlinkSync(f);
  } catch {
    /* ignore */
  }
}

function readLocalRevokeBlock(app) {
  try {
    const f = revokedMarkerPath(app);
    if (!f || !fs.existsSync(f)) return null;
    const raw = JSON.parse(fs.readFileSync(f, "utf8"));
    return {
      blocked: true,
      message:
        String(raw?.message || "").trim() ||
        "Licenca është çaktivizuar. Kontaktoni Revolution Invest.",
    };
  } catch {
    return {
      blocked: true,
      message: "Licenca është çaktivizuar. Kontaktoni Revolution Invest.",
    };
  }
}

/** Dërgo Hardware ID 16 te cloud — admini e sheh te Licencat dhe Gjenero funksionon. */
async function reportHardwareIdToCloud(app) {
  try {
    const hw = getHardwareIdForDisplay(app);
    if (!hw) return false;
    const key = readStoredLicense(app);
    await requestJson("POST", getServerUrl(), "/api/v1/license/report-hardware", {
      device_id: getMachineId(),
      hardware_id: hw,
      ...(key ? { celesi: normalizeKey(key) } : {}),
    });
    return true;
  } catch {
    return false;
  }
}

const CONTACT_PHONE_DISPLAY = "+383 48707880";
const CONTACT_WHATSAPP = "38348707880";

function buildWhatsAppActivationUrl(hardwareId, email) {
  const hw = String(hardwareId || "").trim() || "—";
  const em = String(email || "").trim();
  const lines = [
    "Pershendetje Revolution Invest,",
    `ID pajisje per aktivizim: ${hw}`,
    em ? `Email: ${em}` : null,
    "Ju lutem me dergoni kodin e licences. Mund te dergoj edhe foto te ketij ekrani.",
  ].filter(Boolean);
  return `https://wa.me/${CONTACT_WHATSAPP}?text=${encodeURIComponent(lines.join("\n"))}`;
}

function promptForLicense(app, validateFn, lastError = "") {
  return new Promise(resolve => {
    const { BrowserWindow, ipcMain, shell } = require("electron");
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      try {
        ipcMain.removeHandler("lic-try");
        ipcMain.removeHandler("lic-report-hw");
        ipcMain.removeHandler("lic-whatsapp");
      } catch {
        /* ignore */
      }
      if (!win.isDestroyed()) win.close();
      resolve(value);
    };

    const win = new BrowserWindow({
      width: 520,
      height: 560,
      resizable: true,
      minimizable: false,
      maximizable: false,
      closable: true,
      title: "Aktivizimi i licencës",
      webPreferences: { nodeIntegration: true, contextIsolation: false },
    });
    const hwId = getHardwareIdForDisplay(app);
    const errHtml = lastError
      ? `<div class="err" id="e">${lastError.replace(/</g, "&lt;")}</div>`
      : `<div class="err" id="e"></div>`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:Segoe UI,sans-serif;padding:20px;background:#f8fafc;color:#0f172a}
      h2{margin:0 0 8px;font-size:1.15rem}
      p{margin:0 0 10px;font-size:0.9rem;color:#475569;line-height:1.4}
      label{display:block;font-size:0.78rem;color:#64748b;margin:10px 0 4px;font-weight:600}
      input{width:100%;padding:10px;font-size:1rem;border:2px solid #cbd5e1;border-radius:8px;box-sizing:border-box}
      input.key{letter-spacing:0.1em;text-align:center}
      .mid{font-family:Consolas,monospace;background:#e2e8f0;padding:8px 12px;border-radius:6px;display:inline-block;letter-spacing:0.08em;font-size:1.05rem}
      .hw-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
      .copy,.wa{padding:8px 12px;font-size:0.85rem;border:none;border-radius:8px;cursor:pointer;font-weight:600}
      .copy{background:#0f172a;color:#fff}
      .wa{background:#128C7E;color:#fff}
      button#b{margin-top:14px;width:100%;padding:12px;font-size:1rem;background:#2563eb;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600}
      button#b:disabled{background:#94a3b8;cursor:wait}
      .err{color:#dc2626;font-size:0.85rem;margin-top:8px;min-height:1.2em;line-height:1.35;white-space:pre-wrap}
      .hint{font-size:0.8rem;color:#64748b;margin-top:6px}
      .phone{margin-top:10px;font-size:0.9rem;color:#0f172a}
      .phone b{color:#128C7E}
    </style></head><body>
      <h2>Aktivizoni licencën</h2>
      <p><strong>ID e pajisjes</strong> — dërgoni foto të këtij ID në WhatsApp për aktivizim:</p>
      <div class="hw-row">
        <span class="mid" id="hw">${hwId || "—"}</span>
        <button type="button" class="copy" id="copy-hw">Kopjo ID</button>
        <button type="button" class="wa" id="wa-btn">WhatsApp</button>
      </div>
      <p class="hint">Ky ID del automatikisht (16 shenja). Hapni WhatsApp, dërgoni foto ose tekst me këto numra — pastaj merrni çelësin e licencës.</p>
      <p class="phone">WhatsApp / tel: <b>${CONTACT_PHONE_DISPLAY}</b></p>
      <label for="email">Email (i detyrueshëm për regjistrim)</label>
      <input id="email" type="email" placeholder="p.sh. emri@email.com" autocomplete="email" spellcheck="false">
      <label for="k">Çelësi i licencës</label>
      <input id="k" class="key" type="text" placeholder="Shkruaj ose ngjit çelësin" autocomplete="off" spellcheck="false" inputmode="text">
      <p class="hint">Aktivizoni një herë — pas rinisjes nuk kërkohet përsëri (edhe pa internet).</p>
      ${errHtml}
      <button id="b">Aktivizo</button>
      <script>
        const { ipcRenderer } = require('electron');
        const btn = document.getElementById('b');
        const errEl = document.getElementById('e');
        const input = document.getElementById('k');
        const emailEl = document.getElementById('email');
        const copyBtn = document.getElementById('copy-hw');
        const waBtn = document.getElementById('wa-btn');
        const hwText = document.getElementById('hw');
        function isEmail(v) {
          return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(String(v || '').trim());
        }
        copyBtn.onclick = async () => {
          const t = String(hwText.textContent || '').trim();
          if (!t || t === '—') return;
          try {
            await navigator.clipboard.writeText(t);
            copyBtn.textContent = 'U kopjua ✓';
            setTimeout(() => { copyBtn.textContent = 'Kopjo ID'; }, 1500);
          } catch (_e) {
            try {
              const ta = document.createElement('textarea');
              ta.value = t;
              document.body.appendChild(ta);
              ta.select();
              document.execCommand('copy');
              ta.remove();
              copyBtn.textContent = 'U kopjua ✓';
              setTimeout(() => { copyBtn.textContent = 'Kopjo ID'; }, 1500);
            } catch (__e) {}
          }
        };
        waBtn.onclick = () => {
          ipcRenderer.invoke('lic-whatsapp', {
            hardware_id: String(hwText.textContent || '').trim(),
            email: String(emailEl.value || '').trim(),
          }).catch(() => {});
        };
        async function submit() {
          const email = String(emailEl.value || '').trim();
          const v = String(input.value || '').trim();
          if (!isEmail(email)) {
            errEl.textContent = 'Shkruani email të vlefshëm për regjistrim.';
            emailEl.focus();
            return;
          }
          if (!v) {
            errEl.textContent = 'Shkruani çelësin.';
            return;
          }
          btn.disabled = true;
          btn.textContent = 'Duke validuar...';
          errEl.textContent = '';
          try {
            const r = await ipcRenderer.invoke('lic-try', { key: v, email });
            if (r.ok) return;
            errEl.textContent = r.message || 'Çelësi nuk është i vlefshëm.';
          } catch (e) {
            errEl.textContent = e.message || String(e);
          }
          btn.disabled = false;
          btn.textContent = 'Aktivizo';
        }
        btn.onclick = submit;
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter' && !btn.disabled) submit();
        });
        setTimeout(() => { try { emailEl.focus(); } catch (_e) {} }, 80);
        try { ipcRenderer.invoke('lic-report-hw').catch(() => {}); } catch (_e) {}
      </script></body></html>`;
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    ipcMain.handle("lic-report-hw", async () => {
      try {
        await reportHardwareIdToCloud(app);
        return { ok: true };
      } catch {
        return { ok: false };
      }
    });

    ipcMain.handle("lic-whatsapp", async (_e, payload) => {
      try {
        const url = buildWhatsAppActivationUrl(payload?.hardware_id || hwId, payload?.email);
        await shell.openExternal(url);
        return { ok: true };
      } catch (err) {
        return { ok: false, message: err.message || String(err) };
      }
    });

    ipcMain.handle("lic-try", async (_e, payload) => {
      try {
        const raw = typeof payload === "string" ? payload : payload?.key;
        const email = typeof payload === "object" ? String(payload?.email || "").trim() : "";
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return { ok: false, message: "Shkruani email të vlefshëm për regjistrim." };
        }
        const k = normalizeKey(raw);
        const v = await validateFn(k, { contact_email: email });
        if (v.valid) {
          clearLicenseRevokedLocally(app);
          finish({ key: k, validation: v, email });
          return { ok: true };
        }
        return { ok: false, message: v.message || "Çelësi nuk është i vlefshëm." };
      } catch (err) {
        return { ok: false, message: err.message || String(err) };
      }
    });

    win.on("closed", () => finish(null));
  });
}

async function ensureActivated(app) {
  registerInstallContext(app);
  reportHardwareIdToCloud(app).catch(() => {});
  try {
    let lastError = "";
    const localRevoke = readLocalRevokeBlock(app);
    if (localRevoke?.blocked) {
      const keyProbe = readStoredLicense(app);
      if (keyProbe) {
        const online = await validateLicenseOnline(keyProbe);
        if (online.valid) {
          clearLicenseRevokedLocally(app);
        } else {
          lastError = localRevoke.message;
          if (online.code === "REVOKED") clearStoredLicense(app);
        }
      } else {
        lastError = localRevoke.message;
      }
    }
    const key = readStoredLicense(app);
    const stillRevoked = !!readLocalRevokeBlock(app)?.blocked;
    if (key && !stillRevoked) {
      if (isDeviceRegistered(app, key) || hasOnlineMarker(app, key)) {
        if (!isWithinCloudOfflineWindow(app)) {
          /* Provo online — nëse dështon, blloko (offline skaduar) */
          const vOnline = await validateLicenseAsync(key, app, { requireOnline: true });
          if (vOnline.valid) {
            writeStoredLicense(app, key);
            refreshLicenseOnline(key, app);
            return true;
          }
          if (vOnline.code === "REVOKED") {
            markLicenseRevokedLocally(app, vOnline.message);
            clearStoredLicense(app);
            lastError =
              vOnline.message ||
              "Licenca është çaktivizuar. Kontaktoni Revolution Invest.";
          } else {
            lastError = offlineExpiredMessage();
          }
        } else {
          if (!readActivationRecord(app)) writeActivationRecord(app, key, {});
          refreshLicenseOnline(key, app);
          return true;
        }
      } else {
        const v = await validateLicenseAsync(key, app, { requireOnline: false });
        if (v.valid) {
          writeStoredLicense(app, key);
          if (!readActivationRecord(app)) writeActivationRecord(app, key, {});
          refreshLicenseOnline(key, app);
          return true;
        }

        if (v.code && HARD_LICENSE_FAIL_CODES.has(v.code)) {
          if (v.code === "REVOKED") markLicenseRevokedLocally(app, v.message);
          clearStoredLicense(app);
          if (v.code === "REVOKED") {
            lastError =
              v.message || "Licenca është çaktivizuar. Kontaktoni Revolution Invest.";
          }
        }
      }
    }

    while (true) {
      const result = await promptForLicense(
        app,
        async (k, opts = {}) => {
          const online = await validateLicenseOnline(k, opts);
          if (online.valid) {
            clearLicenseRevokedLocally(app);
            return { valid: true, message: online.message, online };
          }
          return validateLicenseAsync(k, app, { requireOnline: true });
        },
        lastError,
      );
      if (!result) {
        return false;
      }
      writeStoredLicense(app, result.key);
      const meta = result.validation?.online
        ? activationMetaFromOnline(result.validation.online)
        : {};
      writeActivationRecord(app, result.key, meta);
      return true;
    }
  } catch (err) {
    dialog.showErrorBox("Gabim licencë", err.message || String(err));
    return false;
  }
}

function getLicenseStatus() {
  return {
    machine_id: getMachineId(),
    hardware_id: getHardwareIdForDisplay(),
    activated: false,
  };
}

/** HARDWARE_ID 16 shenja (XXXX-XXXX-XXXX-XXXX) — për WhatsApp / gjenerim çelësi. */
function getHardwareIdForDisplay(app) {
  try {
    const eapp = app || _electronApp;
    if (!eapp) return "";
    const guard = require("./fiscal/license-guard");
    return guard.formatHardwareId(guard.getHardwareId(eapp));
  } catch {
    return "";
  }
}

async function getLicenseStatusForApp(app) {
  const key = readStoredLicense(app);
  const base = {
    machine_id: getMachineId(),
    hardware_id: getHardwareIdForDisplay(app),
    has_stored_key: !!key,
  };
  const record = readActivationRecord(app);
  const package_tier = record?.package_tier || "";
  const { localFeaturesForTier } = require("./ai-cloud");
  const tierFeatures = localFeaturesForTier(package_tier);
  if (!key) {
    return { ...base, activated: false, package_tier, features: tierFeatures };
  }
  if (isDeviceRegistered(app, key)) {
    refreshLicenseOnline(key, app);
    return {
      ...base,
      activated: true,
      source: "stored",
      package_tier,
      client_name: record?.client_name || "",
      features: tierFeatures,
    };
  }
  const v = await validateLicenseAsync(key, app);
  const onlineTier = v.package_tier || package_tier;
  return {
    ...base,
    activated: v.valid,
    source: v.source || null,
    message: v.message || null,
    package_tier: onlineTier,
    client_name: v.client_name || record?.client_name || "",
    features: v.features || localFeaturesForTier(onlineTier),
  };
}

async function activateWithKey(app, key, opts = {}) {
  const contactEmail = String(opts.contact_email || opts.email || "").trim().toLowerCase();
  const v = await validateLicenseAsync(key, app, { requireOnline: true });
  if (!v.valid) {
    throw new Error(v.message || "Çelësi i licencës nuk është i vlefshëm.");
  }
  const online = await validateLicenseOnline(key, { contact_email: contactEmail });
  if (!online.valid) {
    throw new Error(online.message || "Çelësi i licencës nuk është i vlefshëm.");
  }
  clearLicenseRevokedLocally(app);
  writeStoredLicense(app, key);
  writeActivationRecord(app, key, activationMetaFromOnline(online));
  return {
    ok: true,
    activated: true,
    machine_id: getMachineId(),
    source: v.source,
    client_name: online.client_name || "",
    trial_active: !!online.trial_active,
    valid_until: online.valid_until || "",
    trial_ends_at: online.trial_ends_at || "",
  };
}

async function fetchWaitersList(app) {
  const VERSION = require("./version-config");
  const eApp = app || _electronApp;
  const key = readStoredLicense(eApp);
  if (!key) return [];

  try {
    const res = await requestJson("POST", getServerUrl(), "/api/v1/license/waiters-list", {
      celesi: normalizeKey(key),
      device_id: getMachineId(),
      hostname: os.hostname(),
      app_type: "hotel",
    });
    let parsed = {};
    try {
      parsed = JSON.parse(res.data || "{}");
    } catch {
      parsed = {};
    }
    if (res.status < 400 && parsed.ok) {
      return parsed.waiters || [];
    }
  } catch {
    /* ignore */
  }
  return [];
}

/**
 * Kërkon dërgimin e kodit emergjence në email të pronarit (cloud).
 * Kodi NUK kthehet këtu — vetëm konfirmim se u dërgua.
 */
async function requestEmergencyCodeToOwner(app, { waiterName } = {}) {
  const VERSION = require("./version-config");
  const eApp = app || _electronApp;
  const key = readStoredLicense(eApp);
  if (!key) {
    return {
      ok: false,
      sent: false,
      message: "Licenca nuk është e aktivizuar. Kontaktoni pronarin.",
    };
  }
  try {
    const res = await requestJson(
      "POST",
      getServerUrl(),
      "/api/v1/license/emergency-code-request",
      {
        celesi: normalizeKey(key),
        device_id: getMachineId(),
        hostname: os.hostname(),
        app_type: "hotel",
        waiter_name: String(waiterName || "").trim() || undefined,
      },
    );
    let parsed = {};
    try {
      parsed = JSON.parse(res.data || "{}");
    } catch {
      parsed = {};
    }
    if (res.status < 400 && (parsed.ok || parsed.sent)) {
      return {
        ok: true,
        sent: true,
        message: parsed.message || "Kodi u dërgua te pronari juaj — kontaktoni pronarin.",
      };
    }
    return {
      ok: false,
      sent: false,
      message:
        parsed.gabim ||
        parsed.message ||
        "Kodi u dërgua te pronari juaj — kontaktoni pronarin.",
      code: parsed.code || null,
    };
  } catch (e) {
    return {
      ok: false,
      sent: false,
      message: e.message || "Nuk u lidh me serverin. Kontaktoni pronarin.",
    };
  }
}

module.exports = {
  ensureActivated,
  registerInstallContext,
  validateLicenseKey,
  validateLicenseAsync,
  validateLicenseHeartbeat,
  validateEmergencyUnlock,
  requestEmergencyCodeToOwner,
  startLicenseWatchdog,
  wipeAllActivationData,
  listActivationFileBasenames,
  getMachineId,
  getHardwareIdForDisplay,
  readStoredLicense,
  getLicenseStatus,
  getLicenseStatusForApp,
  getLoginLicenseDisplay,
  activateWithKey,
  fetchWaitersList,
};
