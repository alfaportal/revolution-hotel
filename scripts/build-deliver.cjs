/**
 * Standard dorëzimi build — dist/ vetëm Setup i Revolution HOTEL + kopje në Desktop.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const DESKTOP = path.join(os.homedir(), "Desktop");

const ALWAYS_REMOVE = new Set(["win-unpacked", "builder-debug.yml", "latest.yml"]);

/** Instalues legacy / emra të përziera — hiqen gjithmonë nga dist/. */
const LEGACY_JUNK = [
  /^Revolution POS Setup \d/i,
  /^Revolution POS Setup \d.*\.blockmap$/i,
];

function rimraf(p) {
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}

function matchesPrefix(name, projectPrefix) {
  return String(name || "")
    .toUpperCase()
    .startsWith(String(projectPrefix || "").toUpperCase());
}

function isProjectArtifact(name, projectPrefix) {
  if (name.endsWith(".new")) return false;
  if (name.endsWith(".exe") || name.endsWith(".exe.blockmap")) {
    return matchesPrefix(name, projectPrefix);
  }
  if (name.endsWith(".dmg") || name.endsWith(".AppImage")) {
    return matchesPrefix(name, projectPrefix);
  }
  return false;
}

function removeIfJunk(distDir, name) {
  const full = path.join(distDir, name);
  if (ALWAYS_REMOVE.has(name)) {
    rimraf(full);
    console.log(`  − hequr dist/${name}`);
    return true;
  }
  if (name.endsWith(".yml")) {
    fs.unlinkSync(full);
    console.log(`  − hequr dist/${name}`);
    return true;
  }
  if (LEGACY_JUNK.some((re) => re.test(name))) {
    fs.unlinkSync(full);
    console.log(`  − hequr dist/${name} (legacy)`);
    return true;
  }
  return false;
}

/** Para build — hiq përzierjen e vjetër nga dist/. */
function cleanDistBeforeBuild(distDir, projectPrefix) {
  if (!fs.existsSync(distDir)) return;
  console.log(`\n=== Pastrim dist/ (${projectPrefix}) ===`);
  for (const name of fs.readdirSync(distDir)) {
    if (removeIfJunk(distDir, name)) continue;
    if (
      (name.endsWith(".exe") ||
        name.endsWith(".exe.blockmap") ||
        name.endsWith(".dmg") ||
        name.endsWith(".AppImage")) &&
      !isProjectArtifact(name, projectPrefix)
    ) {
      fs.unlinkSync(path.join(distDir, name));
      console.log(`  − hequr dist/${name} (projekt tjetër)`);
    }
  }
}

function copyToDesktop(srcPath, fileName) {
  const dest = path.join(DESKTOP, fileName);
  try {
    fs.copyFileSync(srcPath, dest);
    console.log(`  → Desktop\\${fileName}`);
    return dest;
  } catch (err) {
    if (err.code === "EBUSY" || err.code === "EPERM") {
      const altName = `${fileName}.new`;
      const alt = path.join(DESKTOP, altName);
      fs.copyFileSync(srcPath, alt);
      console.warn(`  ! Desktop locked — ruajtur si Desktop\\${altName}`);
      return alt;
    }
    throw err;
  }
}

/**
 * Pas build — dist/ i pastër + Setup(t) në Desktop.
 * @param {{ distDir: string, projectId: string, projectPrefix: string, desktopPrimary?: string }} opts
 */
function finalizeDistDelivery({ distDir, projectId, projectPrefix, desktopPrimary }) {
  console.log(`\n=== Dorëzim ${projectId}: dist/ + Desktop ===`);
  if (!fs.existsSync(distDir)) {
    console.warn(`  ! dist/ mungon: ${distDir}`);
    return [];
  }

  for (const name of [...fs.readdirSync(distDir)]) {
    if (removeIfJunk(distDir, name)) continue;
    if (
      (name.endsWith(".exe") ||
        name.endsWith(".exe.blockmap") ||
        name.endsWith(".dmg") ||
        name.endsWith(".AppImage")) &&
      !isProjectArtifact(name, projectPrefix)
    ) {
      fs.unlinkSync(path.join(distDir, name));
      console.log(`  − hequr dist/${name}`);
    }
  }

  const installers = fs
    .readdirSync(distDir)
    .filter((n) => n.endsWith(".exe") && !n.endsWith(".new"))
    .sort();

  if (!installers.length) {
    console.warn("  ! Asnjë Setup.exe në dist/");
    return [];
  }

  const copied = [];
  if (desktopPrimary && installers.includes(desktopPrimary)) {
    copyToDesktop(path.join(distDir, desktopPrimary), desktopPrimary);
    copied.push(desktopPrimary);
  } else {
    for (const name of installers) {
      copyToDesktop(path.join(distDir, name), name);
      copied.push(name);
    }
  }

  console.log(`\n✔ dist/: ${distDir}`);
  console.log(`✔ Desktop: ${copied.join(", ")}`);
  return copied;
}

module.exports = { cleanDistBeforeBuild, finalizeDistDelivery, DESKTOP };
