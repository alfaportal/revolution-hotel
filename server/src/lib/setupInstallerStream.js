/**
 * Setup Windows — shkarkohet për klientin VETËM nga domain-i ynë.
 * Burimi mund të jetë skedar lokal ose URL interne (p.sh. GitHub) — klientit NUK i shfaqet GitHub.
 */
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const { getSetupDownloadUrl, getSetupVersion } = require("./publicOrigin");
const { ensureSetupReleaseMeta } = require("./setupReleaseMeta");

/** Emri që sheh klienti kur shkarkon (jo emri i burimit intern). */
const SETUP_FILENAME = "Revolution-POS-Setup.exe";
/** Emri i skedarit lokal / burim GitHub (mbetet KAFENE-Setup.exe). */
const SETUP_SOURCE_FILENAME = "KAFENE-Setup.exe";

function localSetupPath() {
  const fromEnv = String(process.env.SETUP_LOCAL_PATH || "").trim();
  if (fromEnv) return fromEnv;
  const downloads = path.join(__dirname, "..", "..", "public", "downloads");
  const preferred = path.join(downloads, SETUP_FILENAME);
  const legacy = path.join(downloads, SETUP_SOURCE_FILENAME);
  try {
    if (fs.existsSync(preferred) && fs.statSync(preferred).isFile()) return preferred;
  } catch {
    /* ignore */
  }
  return legacy;
}

function resolveSetupSource(plan) {
  const local = localSetupPath();
  try {
    if (local && fs.existsSync(local) && fs.statSync(local).isFile()) {
      return { type: "file", path: local };
    }
  } catch {
    /* ignore */
  }
  const url = getSetupDownloadUrl(plan);
  if (!url) return null;
  return { type: "url", url };
}

function setupContentDisposition() {
  const ver = getSetupVersion();
  const name = ver ? `Revolution-POS-Setup-${ver}.exe` : SETUP_FILENAME;
  return `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function setSetupDownloadHeaders(res, contentLength) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Content-Type", "application/octet-stream");
  res.set("Content-Disposition", setupContentDisposition());
  if (contentLength != null && contentLength !== "") {
    res.set("Content-Length", String(contentLength));
  }
}

/**
 * Stream Setup te klienti (attachment). Asnjë redirect te GitHub.
 * Header-at e attachment vendosen VETËM pasi burimi është i vlefshëm —
 * përndryshe browseri merr 502 me emër .exe → ERR_INVALID_RESPONSE.
 * @returns {Promise<boolean>} true nëse stream filloi
 */
async function streamSetupInstaller(res, plan) {
  /* Siguro meta të freskët nga GitHub para se të zgjidhet URL (auto-publish). */
  try {
    await ensureSetupReleaseMeta();
  } catch {
    /* fallback te DEFAULT / env */
  }
  const source = resolveSetupSource(plan);
  if (!source) return false;

  if (source.type === "file") {
    const stat = fs.statSync(source.path);
    setSetupDownloadHeaders(res, stat.size);
    fs.createReadStream(source.path).pipe(res);
    return true;
  }

  const upstream = await fetch(source.url, {
    redirect: "follow",
    headers: { "User-Agent": "RevolutionPOS-SetupProxy/1.0" },
  });
  if (!upstream.ok || !upstream.body) {
    const err = new Error(`Setup upstream ${upstream.status}`);
    err.code = "SETUP_UPSTREAM";
    err.status = upstream.status;
    throw err;
  }
  setSetupDownloadHeaders(res, upstream.headers.get("content-length"));
  Readable.fromWeb(upstream.body).pipe(res);
  return true;
}

function buildSameOriginDownloadPath(query) {
  const qs = new URLSearchParams();
  qs.set("dl", "1");
  const plan = String(query.plan || "").trim();
  const token = String(query.t || query.token || "").trim();
  if (plan) qs.set("plan", plan);
  if (token) qs.set("t", token);
  return `/api/public/setup-download?${qs.toString()}`;
}

module.exports = {
  SETUP_FILENAME,
  resolveSetupSource,
  streamSetupInstaller,
  buildSameOriginDownloadPath,
  localSetupPath,
};
