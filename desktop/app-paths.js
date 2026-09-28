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

function resolvePackagedPublicFile(segments) {
  if (!segments.length || segments[0] !== "public") return null;
  try {
    const { app } = require("electron");
    if (!app?.isPackaged) return null;
    const rel = segments.slice(1).join("/");
    if (!rel) return null;
    const overlay = publicOverlayRoot();
    if (overlay) {
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
  const rel = String(relativeName || "").replace(/^[/\\]+/, "");
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
};
