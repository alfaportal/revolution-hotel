/**
 * Kontroll integrity në start (prod) — pengon asar/skedarë të ndryshuar lehtë.
 * Nuk zëvendëson asar fuse; shtesë lokale.
 *
 * RËNDËSISHME: përdor original-fs — fs i Electron e trajton app.asar si folder
 * (isFile()=false) dhe bllokonte gabimisht instalimet e mira.
 */
const crypto = require("crypto");
const path = require("path");

/** fs pa asar-virtualization (Electron) */
function diskFs() {
  try {
    return require("original-fs");
  } catch {
    return require("fs");
  }
}

function hashFile(filePath) {
  const ofs = diskFs();
  const h = crypto.createHash("sha256");
  h.update(ofs.readFileSync(filePath));
  return h.digest("hex");
}

/** Fingerprint i shkurtër i app.asar (për watermark / security alerts). */
function getAsarFingerprint(app) {
  if (!app?.isPackaged) return "dev";
  try {
    const ofs = diskFs();
    const asarPath = path.join(process.resourcesPath, "app.asar");
    if (!ofs.existsSync(asarPath)) return "missing";
    return hashFile(asarPath).slice(0, 16);
  } catch {
    return "err";
  }
}

/**
 * @returns {{ ok: boolean, reason?: string }}
 */
function verifyPackagedIntegrity(app) {
  if (!app?.isPackaged) return { ok: true };

  const ofs = diskFs();
  try {
    const resources = process.resourcesPath;
    const asarPath = path.join(resources, "app.asar");
    if (!ofs.existsSync(asarPath)) {
      return { ok: false, reason: "Mungon app.asar — instalimi është i dëmtuar." };
    }

    const asarStat = ofs.statSync(asarPath);
    if (!asarStat.isFile() || asarStat.size < 50_000) {
      return { ok: false, reason: "app.asar i pavlefshëm." };
    }

    /* Manifest opsional nga build (obfuscate-build) */
    let manifest = null;
    try {
      manifest = require("./integrity-manifest.json");
    } catch {
      manifest = null;
    }

    if (manifest && manifest.asar_sha256) {
      const actual = hashFile(asarPath);
      if (actual !== manifest.asar_sha256) {
        return {
          ok: false,
          reason: "Integriteti i programit dështoi (asar i ndryshuar). Riinstaloni Setup zyrtar.",
        };
      }
    }

    /* Kontrollo që modulet kritike ngarkohen nga asar (jo folder i hapur) */
    const mainPath = require.main?.filename || __filename;
    if (mainPath && !mainPath.includes("app.asar") && !mainPath.includes(".asar")) {
      const exeDir = path.dirname(process.execPath);
      const unpackedHint = path.join(exeDir, "resources", "app");
      if (ofs.existsSync(unpackedHint) && !ofs.existsSync(asarPath)) {
        return { ok: false, reason: "Instalim i çpaketuar i dyshimtë." };
      }
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message || "Kontrolli i integritetit dështoi." };
  }
}

module.exports = {
  verifyPackagedIntegrity,
  getAsarFingerprint,
  hashFile,
};
