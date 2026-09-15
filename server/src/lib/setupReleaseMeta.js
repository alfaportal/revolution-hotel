/**
 * Lexon automatikisht release-in e fundit të Setup nga GitHub
 * (alfaportal/revolution-pos-server → tag setup-v* → KAFENE-Setup.exe).
 * Cache në memorie — pa bump manual të versionit në kod.
 */
const DEFAULT_SETUP_RELEASE_REPO = "alfaportal/revolution-pos-server";
const SETUP_TAG_PREFIX = "setup-v";
const CACHE_TTL_MS = Math.max(
  60_000,
  Number(process.env.SETUP_RELEASE_CACHE_MS || 5 * 60 * 1000) || 5 * 60 * 1000,
);

const PUBLIC_ASSET = "KAFENE-Setup.exe";

let cache = {
  tag: null,
  version: null,
  assets: Object.create(null),
  fetchedAt: 0,
};
let inflight = null;

function setupReleaseRepo() {
  return (
    String(process.env.SETUP_RELEASE_REPO || "").trim() ||
    DEFAULT_SETUP_RELEASE_REPO
  );
}

function githubToken() {
  return (
    String(process.env.SETUP_GITHUB_TOKEN || "").trim() ||
    String(process.env.GITHUB_TOKEN || "").trim() ||
    ""
  );
}

function assetUrlFor(tag, filename) {
  const repo = setupReleaseRepo();
  const t = String(tag || "").replace(/^\/+|\/+$/g, "");
  return `https://github.com/${repo}/releases/download/${t}/${filename}`;
}

function versionFromTag(tag) {
  const t = String(tag || "").trim();
  const m = t.match(/setup-v?(\d+\.\d+\.\d+)/i) || t.match(/v?(\d+\.\d+\.\d+)/i);
  return m ? m[1] : t.replace(/^v/i, "");
}

function assetsFromRelease(data) {
  const tag = String(data?.tag_name || "").trim();
  if (!tag) return null;
  const assets = Object.create(null);
  for (const a of data.assets || []) {
    const name = String(a.name || "").trim();
    if (!name) continue;
    const url = String(a.browser_download_url || "").trim();
    assets[name] = url || assetUrlFor(tag, name);
  }
  if (!assets[PUBLIC_ASSET]) return null;
  return {
    tag,
    version: versionFromTag(tag),
    assets,
    fetchedAt: Date.now(),
  };
}

function isSetupRelease(rel) {
  if (!rel || rel.draft || rel.prerelease) return false;
  const tag = String(rel.tag_name || "");
  /* Prefero setup-v*; prano edhe v* nëse ka KAFENE-Setup.exe */
  return (
    tag.toLowerCase().startsWith(SETUP_TAG_PREFIX) ||
    /^v?\d+\.\d+\.\d+/i.test(tag)
  );
}

async function fetchLatestReleaseMeta() {
  const repo = setupReleaseRepo();
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "RevolutionPOS-SetupResolver/1.0",
  };
  const token = githubToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  /* 1) latest — nëse ka KAFENE-Setup.exe */
  const latestRes = await fetch(
    `https://api.github.com/repos/${repo}/releases/latest`,
    { headers, redirect: "follow" },
  );
  if (latestRes.ok) {
    const data = await latestRes.json();
    if (isSetupRelease(data)) {
      const latest = assetsFromRelease(data);
      if (latest) {
        cache = latest;
        return cache;
      }
    }
  } else if (latestRes.status !== 404) {
    throw new Error(`GitHub releases/latest HTTP ${latestRes.status} (${repo})`);
  }

  /* 2) Skano release-et e fundit (setup-v* me KAFENE-Setup.exe) */
  const listRes = await fetch(
    `https://api.github.com/repos/${repo}/releases?per_page=20`,
    { headers, redirect: "follow" },
  );
  if (!listRes.ok) {
    throw new Error(`GitHub releases HTTP ${listRes.status} (${repo})`);
  }
  const list = await listRes.json();
  for (const rel of list || []) {
    if (!isSetupRelease(rel)) continue;
    const parsed = assetsFromRelease(rel);
    if (parsed) {
      cache = parsed;
      return cache;
    }
  }
  throw new Error(
    `Asnjë release te ${repo} nuk ka ${PUBLIC_ASSET} (tag setup-v*)`,
  );
}

function cacheFresh() {
  return !!(cache.version && Date.now() - cache.fetchedAt < CACHE_TTL_MS);
}

/** Refresh në background (jo-bllokues). */
function kickSetupReleaseRefresh() {
  if (cacheFresh() || inflight) return;
  inflight = fetchLatestReleaseMeta()
    .catch((err) => {
      console.warn("[setup-release]", err.message || err);
    })
    .finally(() => {
      inflight = null;
    });
}

/** Pris refresh nëse cache është bosh/i vjetër (për download / verify). */
async function ensureSetupReleaseMeta() {
  if (cacheFresh()) return cache;
  if (!inflight) {
    inflight = fetchLatestReleaseMeta()
      .catch((err) => {
        console.warn("[setup-release]", err.message || err);
        throw err;
      })
      .finally(() => {
        inflight = null;
      });
  }
  try {
    await inflight;
  } catch {
    /* mbaj cache të vjetër nëse ka */
  }
  return cache;
}

function cachedAssetUrl(filename) {
  kickSetupReleaseRefresh();
  const name = String(filename || "").trim();
  return (name && cache.assets[name]) || null;
}

function cachedSetupVersion() {
  kickSetupReleaseRefresh();
  return cache.version || null;
}

function cachedSetupDownloadUrl(plan) {
  /* Setup publik është një skedar; planet p1–p4 mbeten me env URL nëse vendosen. */
  void plan;
  return cachedAssetUrl(PUBLIC_ASSET);
}

/** Nise refresh menjëherë në boot. */
kickSetupReleaseRefresh();

module.exports = {
  PUBLIC_ASSET,
  DEFAULT_SETUP_RELEASE_REPO,
  ensureSetupReleaseMeta,
  kickSetupReleaseRefresh,
  cachedSetupVersion,
  cachedSetupDownloadUrl,
  cachedAssetUrl,
  setupReleaseRepo,
};
