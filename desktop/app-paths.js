"use strict";

const fs = require("fs");
const path = require("path");

/** Rrënjë e përmbajtjes së app (public/, build/) — edhe kur entry është në app.asar.unpacked. */
function getAppContentRoot() {
  try {
    const { app } = require("electron");
    if (app?.isPackaged && typeof app.getAppPath === "function") {
      return app.getAppPath();
    }
  } catch {
    /* jo në Electron */
  }
  return __dirname;
}

function publicOverlayRoot() {
  try {
    const { app } = require("electron");
    if (app?.isPackaged && typeof app.getPath === "function") {
      return path.join(app.getPath("userData"), "public-overlay");
    }
  } catch {
    /* jo në Electron */
  }
  return null;
}

/** Vetëm këto skedarë lejohen nga public-overlay (sync-installed-public.ps1). */
const PUBLIC_OVERLAY_ALLOW = new Set([
  "kasa-recepcion.html",
  "recepcion.html",
  "login.html",
  "admin.html",
  "css/recepcion-truffle.css",
  "js/hotel-recipe-workbench-admin.js",
]);

function normalizePublicRel(rel) {
  return String(rel || "").replace(/\\/g, "/").replace(/^[/]+/, "");
}

function isPublicOverlayAllowed(rel) {
  return PUBLIC_OVERLAY_ALLOW.has(normalizePublicRel(rel));
}

const OVERLAY_VERSION_FILE = ".overlay-app-version";

/** Pas Setup të ri: fshi skedarët e vjetër të public-overlay që e fshehin UI-në e paketës. */
function clearPublicOverlayOnAppUpgrade() {
  const overlay = publicOverlayRoot();
  if (!overlay) return;
  let current = "";
  try {
    current = String(require("./package.json").version || "").trim();
  } catch {
    return;
  }
  if (!current) return;
  const marker = path.join(overlay, OVERLAY_VERSION_FILE);
  let prev = "";
  try {
    prev = String(fs.readFileSync(marker, "utf8") || "").trim();
  } catch {
    /* first run */
  }
  if (prev && prev === current) return;

  for (const rel of PUBLIC_OVERLAY_ALLOW) {
    const abs = path.join(overlay, rel);
    if (!fs.existsSync(abs)) continue;
    try {
      fs.unlinkSync(abs);
      console.warn("[public-overlay] hequr pas përditësimit Setup:", rel);
    } catch (e) {
      console.warn("[public-overlay] clear on upgrade:", rel, e.message || e);
    }
  }
  try {
    fs.mkdirSync(overlay, { recursive: true });
    fs.writeFileSync(marker, `${current}\n`, "utf8");
  } catch {
    /* ignore */
  }
}

/** Heq admin.html / JS të vjetër nga overlay — ndryshe mbivendos Setup-in edhe pas reinstall. */
function pruneStalePublicOverlay() {
  const overlay = publicOverlayRoot();
  if (!overlay || !fs.existsSync(overlay)) return;
  const removeIfDisallowed = (abs, relFromOverlay) => {
    if (isPublicOverlayAllowed(relFromOverlay)) return;
    try {
      fs.unlinkSync(abs);
      console.warn("[public-overlay] hequr skedar i palejuar:", relFromOverlay);
    } catch (e) {
      console.warn("[public-overlay] prune:", relFromOverlay, e.message || e);
    }
  };
  const walk = (dir, prefix) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs, rel);
      else if (ent.isFile()) removeIfDisallowed(abs, rel);
    }
  };
  walk(overlay, "");
}

function readBundledLoginHtml(rel = "login.html") {
  const candidates = [
    path.join(getAppContentRoot(), "public", rel),
    path.join(__dirname, "public", rel),
  ];
  try {
    if (process.resourcesPath) {
      candidates.unshift(
        path.join(process.resourcesPath, "app.asar.unpacked", "public", rel),
      );
    }
  } catch {
    /* ignore */
  }
  for (const c of candidates) {
    if (!c || !fs.existsSync(c)) continue;
    try {
      const text = fs.readFileSync(c, "utf8");
      const isNewZoneLayout =
        /id="login-zone-pick"/.test(text) && !/btn-login-role-restaurant/.test(text);
      if (isNewZoneLayout) return { path: c, text };
    } catch {
      /* provo kandidatin tjetër */
    }
  }
  for (const c of candidates) {
    if (!c || !fs.existsSync(c)) continue;
    try {
      return { path: c, text: fs.readFileSync(c, "utf8") };
    } catch {
      /* ignore */
    }
  }
  return null;
}

function overlayLoginNeedsRefresh(overlayText, bundledText) {
  if (!overlayText || !bundledText) return false;
  const overlayUses4 =
    /pinValue\.length !== 4/.test(overlayText) ||
    /Shkruani PIN-in \(4 shifra\)/.test(overlayText);
  const overlayOldZoneUi =
    /btn-login-role-restaurant|id="login-role-btns"|class="login-role-btns"/.test(overlayText);
  const bundledNewZoneUi =
    /id="login-zone-pick"/.test(bundledText) &&
    !/btn-login-role-restaurant/.test(bundledText);
  return overlayUses4 || (overlayOldZoneUi && bundledNewZoneUi);
}

/** login.html në overlay — zëvendëso nga Setup kur PIN/zona UI është e vjetër. */
function refreshStalePinLoginOverlay() {
  const overlay = publicOverlayRoot();
  if (!overlay) return;
  const rel = "login.html";
  const overlayFile = path.join(overlay, rel);
  if (!fs.existsSync(overlayFile)) return;

  const bundled = readBundledLoginHtml(rel);
  if (!bundled) return;

  try {
    const overlayText = fs.readFileSync(overlayFile, "utf8");
    if (!overlayLoginNeedsRefresh(overlayText, bundled.text)) return;
    fs.copyFileSync(bundled.path, overlayFile);
    console.warn("[public-overlay] login.html u përditësua nga paketa (PIN/zona hyrje).");
  } catch (e) {
    console.warn("[public-overlay] refresh login.html:", e.message || e);
    try {
      const overlayText = fs.readFileSync(overlayFile, "utf8");
      if (/btn-login-role-restaurant/.test(overlayText)) {
        fs.unlinkSync(overlayFile);
        console.warn("[public-overlay] login.html i vjetër u fshi — përdoret Setup.");
      }
    } catch {
      /* ignore */
    }
  }
}

function resolvePackagedPublicFile(segments) {
  if (!segments.length || segments[0] !== "public") return null;
  try {
    const { app } = require("electron");
    if (!app?.isPackaged) return null;
    const rel = segments.slice(1).join("/");
    if (!rel) return null;
    const overlay = publicOverlayRoot();
    if (overlay && isPublicOverlayAllowed(rel)) {
      const overlayFile = path.join(overlay, rel);
      if (fs.existsSync(overlayFile)) {
        if (rel === "login.html") {
          try {
            const ot = fs.readFileSync(overlayFile, "utf8");
            if (/btn-login-role-restaurant|class="login-role-btns"/.test(ot)) {
              /* overlay i vjetër — mos e prefero mbi Setup (refresh duhet ta zëvendësojë) */
            } else {
              return overlayFile;
            }
          } catch {
            return overlayFile;
          }
        } else {
          return overlayFile;
        }
      }
    }
    const resourcesPath = process.resourcesPath;
    if (resourcesPath) {
      const unpackedFile = path.join(resourcesPath, "app.asar.unpacked", ...segments);
      if (fs.existsSync(unpackedFile)) return unpackedFile;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function joinContent(...segments) {
  const packagedPublic = resolvePackagedPublicFile(segments);
  if (packagedPublic) return packagedPublic;
  if (segments.length >= 2 && segments[0] === "public") {
    const devPublic = path.join(__dirname, "public", ...segments.slice(1));
    if (fs.existsSync(devPublic)) return devPublic;
  }
  return path.join(getAppContentRoot(), ...segments);
}

/** Radhë static: overlay → unpacked → dev public → asar */
function listPublicStaticRoots() {
  const roots = [];
  const seen = new Set();
  const push = (p) => {
    const n = path.normalize(p);
    if (!seen.has(n) && fs.existsSync(n)) {
      seen.add(n);
      roots.push(n);
    }
  };
  const overlay = publicOverlayRoot();
  if (overlay) push(overlay);
  try {
    const { app } = require("electron");
    if (app?.isPackaged && process.resourcesPath) {
      push(path.join(process.resourcesPath, "app.asar.unpacked", "public"));
    }
  } catch {
    /* ignore */
  }
  push(path.join(__dirname, "public"));
  push(joinContent("public"));
  return roots;
}

function resolvePublicFile(relativeName) {
  const rel = normalizePublicRel(relativeName);
  const overlay = publicOverlayRoot();
  if (overlay && isPublicOverlayAllowed(rel)) {
    const overlayFile = path.join(overlay, rel);
    if (fs.existsSync(overlayFile)) return overlayFile;
  }
  const packaged = resolvePackagedPublicFile(["public", rel]);
  if (packaged && fs.existsSync(packaged)) return packaged;
  const dev = path.join(__dirname, "public", rel);
  if (fs.existsSync(dev)) return dev;
  return joinContent("public", rel);
}

module.exports = {
  getAppContentRoot,
  joinContent,
  listPublicStaticRoots,
  resolvePublicFile,
  clearPublicOverlayOnAppUpgrade,
  pruneStalePublicOverlay,
  refreshStalePinLoginOverlay,
  isPublicOverlayAllowed,
};
