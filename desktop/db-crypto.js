/**
 * db-crypto.js — AES-256-GCM për hotel.db dhe çelësat privat fiskalë në pushim.
 *
 * - Çelës master 32-byte (random) i mbrojtur me Windows DPAPI (CurrentUser).
 * - Fallback jo-Windows: scrypt + fingerprint makine + salt instalimi.
 * - Format skedari: HTLENC1\0 + IV(12) + authTag(16) + ciphertext
 * - Migrim automatik: plain SQLite ose legacy RHDB1 → HTLENC1
 *
 * Ky skedar NUK obfuskohet (përdoret nga db-engine.js).
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const MAGIC = Buffer.from("HTLENC1\0", "ascii");
const LEGACY_RHDB1 = Buffer.from([0x52, 0x48, 0x44, 0x42, 0x31, 0x00]);
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const ALGO = "aes-256-gcm";
const SCrypt_N = 16384;
const SCrypt_r = 8;
const SCrypt_p = 1;

const WRAPPED_DPAPI = ".db-master.dpapi";
const WRAPPED_SCRYPT = ".db-master.scrypt";
const INSTALL_SALT = ".db-install-salt";

const PRIVATE_NAMES = ["private-key.pem", "private.pem"];

let _masterKey = null;

function defaultHotelDbPath() {
  return path.join(os.homedir(), "AppData", "Roaming", "Revolution HOTEL", "hotel.db");
}

function getDbDir() {
  const dbPath =
    process.env.HOTEL_DB_PATH ||
    process.env.DB_PATH ||
    defaultHotelDbPath();
  return path.dirname(dbPath);
}

function getDbPath() {
  return (
    process.env.HOTEL_DB_PATH ||
    process.env.DB_PATH ||
    defaultHotelDbPath()
  );
}

function wrappedDpapiPath(dir) {
  return path.join(dir, WRAPPED_DPAPI);
}

function wrappedScryptPath(dir) {
  return path.join(dir, WRAPPED_SCRYPT);
}

function installSaltPath(dir) {
  return path.join(dir, INSTALL_SALT);
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function isDpapiAvailable() {
  return process.platform === "win32";
}

function dpapiProtect(plainBuffer) {
  const tmpIn = path.join(os.tmpdir(), `htlenc-in-${process.pid}-${Date.now()}.bin`);
  const tmpOut = path.join(os.tmpdir(), `htlenc-out-${process.pid}-${Date.now()}.bin`);
  const psIn = tmpIn.replace(/'/g, "''");
  const psOut = tmpOut.replace(/'/g, "''");
  const script = [
    "Add-Type -AssemblyName System.Security",
    `$in='${psIn}'`,
    `$out='${psOut}'`,
    "$bytes=[IO.File]::ReadAllBytes($in)",
    "$prot=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[IO.File]::WriteAllBytes($out,$prot)",
  ].join("; ");
  try {
    fs.writeFileSync(tmpIn, plainBuffer);
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { stdio: "pipe", windowsHide: true }
    );
    return fs.readFileSync(tmpOut);
  } finally {
    for (const f of [tmpIn, tmpOut]) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* */
      }
    }
  }
}

function dpapiUnprotect(protectedBuffer) {
  const tmpIn = path.join(os.tmpdir(), `htlenc-u-in-${process.pid}-${Date.now()}.bin`);
  const tmpOut = path.join(os.tmpdir(), `htlenc-u-out-${process.pid}-${Date.now()}.bin`);
  const psIn = tmpIn.replace(/'/g, "''");
  const psOut = tmpOut.replace(/'/g, "''");
  const script = [
    "Add-Type -AssemblyName System.Security",
    `$in='${psIn}'`,
    `$out='${psOut}'`,
    "$bytes=[IO.File]::ReadAllBytes($in)",
    "$plain=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[IO.File]::WriteAllBytes($out,$plain)",
  ].join("; ");
  try {
    fs.writeFileSync(tmpIn, protectedBuffer);
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { stdio: "pipe", windowsHide: true }
    );
    return fs.readFileSync(tmpOut);
  } finally {
    for (const f of [tmpIn, tmpOut]) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* */
      }
    }
  }
}

function machineFingerprint() {
  let user = "";
  try {
    user = os.userInfo().username || "";
  } catch {
    user = process.env.USERNAME || process.env.USER || "";
  }
  return [os.hostname(), user, os.platform(), os.arch(), "revolution-hotel-v1"].join("|");
}

function getOrCreateInstallSalt(dir) {
  ensureDir(dir);
  const p = installSaltPath(dir);
  if (fs.existsSync(p)) {
    return fs.readFileSync(p);
  }
  const salt = crypto.randomBytes(32);
  fs.writeFileSync(p, salt, { mode: 0o600 });
  return salt;
}

function scryptWrapKey(masterKey, dir) {
  const salt = getOrCreateInstallSalt(dir);
  const derived = crypto.scryptSync(machineFingerprint(), salt, KEY_LEN, {
    N: SCrypt_N,
    r: SCrypt_r,
    p: SCrypt_p,
  });
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, derived, iv);
  const enc = Buffer.concat([cipher.update(masterKey), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

function scryptUnwrapKey(wrapped, dir) {
  if (wrapped.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("db-crypto: wrapped key i shkurtër (scrypt)");
  }
  const salt = getOrCreateInstallSalt(dir);
  const derived = crypto.scryptSync(machineFingerprint(), salt, KEY_LEN, {
    N: SCrypt_N,
    r: SCrypt_r,
    p: SCrypt_p,
  });
  const iv = wrapped.subarray(0, IV_LEN);
  const tag = wrapped.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = wrapped.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, derived, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

function wrapMasterKey(masterKey, dir) {
  ensureDir(dir);
  if (isDpapiAvailable()) {
    const wrapped = dpapiProtect(masterKey);
    fs.writeFileSync(wrappedDpapiPath(dir), wrapped, { mode: 0o600 });
    try {
      fs.unlinkSync(wrappedScryptPath(dir));
    } catch {
      /* */
    }
    return;
  }
  const wrapped = scryptWrapKey(masterKey, dir);
  fs.writeFileSync(wrappedScryptPath(dir), wrapped, { mode: 0o600 });
}

function unwrapMasterKey(dir) {
  const dpapiPath = wrappedDpapiPath(dir);
  const scryptPath = wrappedScryptPath(dir);
  if (fs.existsSync(dpapiPath)) {
    return dpapiUnprotect(fs.readFileSync(dpapiPath));
  }
  if (fs.existsSync(scryptPath)) {
    return scryptUnwrapKey(fs.readFileSync(scryptPath), dir);
  }
  return null;
}

function getOrCreateMasterKey(dir) {
  if (_masterKey) return _masterKey;
  const existing = unwrapMasterKey(dir);
  if (existing && existing.length === KEY_LEN) {
    _masterKey = existing;
    return _masterKey;
  }
  _masterKey = crypto.randomBytes(KEY_LEN);
  wrapMasterKey(_masterKey, dir);
  return _masterKey;
}

function isEncryptedBuffer(buf) {
  return (
    Buffer.isBuffer(buf) &&
    buf.length >= MAGIC.length &&
    buf.subarray(0, MAGIC.length).equals(MAGIC)
  );
}

function isLegacyRhdb1(buf) {
  return (
    Buffer.isBuffer(buf) &&
    buf.length >= LEGACY_RHDB1.length &&
    buf.subarray(0, LEGACY_RHDB1.length).equals(LEGACY_RHDB1)
  );
}

function isPlainSqlite(buf) {
  return (
    Buffer.isBuffer(buf) &&
    buf.length >= 16 &&
    buf.subarray(0, 16).toString("ascii") === "SQLite format 3\u0000"
  );
}

function readHotelInstallSalt() {
  try {
    const saltPath = path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      "RevolutionInvest",
      "HotelLicense",
      ".install-salt"
    );
    if (fs.existsSync(saltPath)) {
      return String(fs.readFileSync(saltPath, "utf8") || "").trim();
    }
  } catch {
    /* */
  }
  return "";
}

function deriveLegacyRhdb1Key() {
  let material = "";
  try {
    const guard = require("./fiscal/license-guard");
    material = "rh-db-v1|" + String(guard.getHardwareId(null) || "");
  } catch {
    const salt = readHotelInstallSalt() || os.hostname() || "local";
    material = [
      "rh-db-v1",
      salt,
      os.hostname() || "",
      process.env.COMPUTERNAME || "",
      process.env.USERNAME || process.env.USER || "",
    ].join("|");
  }
  return crypto.createHash("sha256").update(material).digest();
}

function decryptLegacyRhdb1(fileBuf) {
  const key = deriveLegacyRhdb1Key();
  const iv = fileBuf.subarray(LEGACY_RHDB1.length, LEGACY_RHDB1.length + 12);
  const tag = fileBuf.subarray(LEGACY_RHDB1.length + 12, LEGACY_RHDB1.length + 28);
  const data = fileBuf.subarray(LEGACY_RHDB1.length + 28);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

function encryptBuffer(plaintext, dir) {
  const key = getOrCreateMasterKey(dir);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, tag, enc]);
}

function decryptBuffer(ciphertext, dir) {
  if (!isEncryptedBuffer(ciphertext)) {
    throw new Error("db-crypto: skedar i palekriptuar ose format i panjohur");
  }
  const key = getOrCreateMasterKey(dir);
  const body = ciphertext.subarray(MAGIC.length);
  if (body.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("db-crypto: blob i shkurtër");
  }
  const iv = body.subarray(0, IV_LEN);
  const tag = body.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = body.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

function loadDatabaseBytes(dbPath) {
  const dir = path.dirname(dbPath);
  ensureDir(dir);
  if (!fs.existsSync(dbPath)) {
    return { bytes: null, wasPlain: false, wasLegacy: false };
  }
  const raw = fs.readFileSync(dbPath);
  if (isEncryptedBuffer(raw)) {
    return { bytes: decryptBuffer(raw, dir), wasPlain: false, wasLegacy: false };
  }
  if (isLegacyRhdb1(raw)) {
    return { bytes: decryptLegacyRhdb1(raw), wasPlain: false, wasLegacy: true };
  }
  if (isPlainSqlite(raw)) {
    return { bytes: raw, wasPlain: true, wasLegacy: false };
  }
  throw new Error("db-crypto: hotel.db nuk është SQLite e vlefshme as e enkriptuar");
}

function saveDatabaseBytes(dbPath, sqliteBytes) {
  const dir = path.dirname(dbPath);
  ensureDir(dir);
  const enc = encryptBuffer(sqliteBytes, dir);
  fs.writeFileSync(dbPath, enc, { mode: 0o600 });
}

function encryptedPathFor(pemPath) {
  return `${pemPath}.enc`;
}

function readPrivatePem(pemPath) {
  const encPath = encryptedPathFor(pemPath);
  const dir = path.dirname(pemPath);
  if (fs.existsSync(encPath)) {
    const plain = decryptBuffer(fs.readFileSync(encPath), dir);
    return plain.toString("utf8");
  }
  if (fs.existsSync(pemPath)) {
    const pem = fs.readFileSync(pemPath, "utf8");
    writePrivatePem(pemPath, pem);
    return pem;
  }
  return null;
}

function writePrivatePem(pemPath, pemText) {
  const dir = path.dirname(pemPath);
  ensureDir(dir);
  const encPath = encryptedPathFor(pemPath);
  const enc = encryptBuffer(Buffer.from(String(pemText), "utf8"), dir);
  fs.writeFileSync(encPath, enc, { mode: 0o600 });
  try {
    fs.unlinkSync(pemPath);
  } catch {
    /* */
  }
}

function lockPrivateKeyFiles(keysDir) {
  if (!keysDir || !fs.existsSync(keysDir)) return { locked: 0 };
  let locked = 0;
  for (const name of PRIVATE_NAMES) {
    const pemPath = path.join(keysDir, name);
    const encPath = encryptedPathFor(pemPath);
    if (fs.existsSync(pemPath)) {
      const pem = fs.readFileSync(pemPath, "utf8");
      writePrivatePem(pemPath, pem);
      locked += 1;
    } else if (fs.existsSync(encPath)) {
      locked += 1;
    }
  }
  return { locked };
}

function migratePlainPrivateKeys(keysDir) {
  return lockPrivateKeyFiles(keysDir);
}

function hasPrivateKeyMaterial(keysDir, storedPath) {
  const candidates = [];
  if (storedPath) candidates.push(storedPath);
  for (const name of PRIVATE_NAMES) {
    candidates.push(path.join(keysDir, name));
  }
  for (const base of candidates) {
    if (!base) continue;
    if (fs.existsSync(encryptedPathFor(base)) || fs.existsSync(base)) return true;
  }
  return false;
}

module.exports = {
  getDbDir,
  getDbPath,
  getOrCreateMasterKey,
  encryptBuffer,
  decryptBuffer,
  isEncryptedBuffer,
  isLegacyRhdb1,
  isPlainSqlite,
  loadDatabaseBytes,
  saveDatabaseBytes,
  readPrivatePem,
  writePrivatePem,
  lockPrivateKeyFiles,
  migratePlainPrivateKeys,
  hasPrivateKeyMaterial,
  encryptedPathFor,
};
