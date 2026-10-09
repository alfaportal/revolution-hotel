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
  "css/recepcion-truffle.css",
]);

function normalizePublicRel(rel) {
  return String(rel || "").replace(/\\/g, "/").replace(/^[/]+/, "");
}

function isPublicOverlayAllowed(rel) {
  return PUBLIC_OVERLAY_ALLOW.has(normalizePublicRel(rel));
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

/** login.html në overlay me PIN 4-shifror → zëvendëso nga paketa/burimi 6-shifror. */
function refreshStalePinLoginOverlay() {
  const overlay = publicOverlayRoot();
  if (!overlay) return;
  const rel = "login.html";
  const overlayFile = path.join(overlay, rel);
  if (!fs.existsSync(overlayFile)) return;

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

  let bundledFile = null;
  for (const c of candidates) {
    if (!c || !fs.existsSync(c)) continue;
    try {
      const text = fs.readFileSync(c, "utf8");
      if (/pinValue\.length !== 6/.test(text)) {
        bundledFile = c;
        break;
      }
    } catch {
      /* provo kandidatin tjetër */
    }
  }
  if (!bundledFile) return;

  try {
    const overlayText = fs.readFileSync(overlayFile, "utf8");
    const overlayUses4 =
      /pinValue\.length !== 4/.test(overlayText) ||
      /Shkruani PIN-in \(4 shifra\)/.test(overlayText);
    if (!overlayUses4) return;
    fs.copyFileSync(bundledFile, overlayFile);
    console.warn("[public-overlay] login.html u përditësua (PIN 6 shifra).");
  } catch (e) {
    console.warn("[public-overlay] refresh login.html:", e.message || e);
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
      if (fs.existsSync(overlayFile)) return overlayFile;
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
  pruneStalePublicOverlay,
  refreshStalePinLoginOverlay,
  isPublicOverlayAllowed,
};
