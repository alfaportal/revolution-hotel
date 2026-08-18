/**
 * Ndërton instalues Revolution HOTEL në dist/:
 *   Një Setup (Pako 4 / Full+AI). Pako 3 ndryshohet nga telefoni (cloud license), jo Setup i dytë.
 *
 * Përdorimi:
 *   node build-packages.js             # Windows KS — një Setup
 *   node build-packages.js 4 --fr      # France
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PROTECTED_DIR = path.join(ROOT, ".protected-build");
const DIST_DIR = path.join(ROOT, "dist");
const OBFUSCATE_SCRIPT = path.join(ROOT, "..", "scripts", "obfuscate-build.mjs");
const {
  cleanDistBeforeBuild,
  finalizeDistDelivery,
} = require(path.join(ROOT, "..", "scripts", "build-deliver.js"));

const BUILD_MAC =
  process.argv.includes("--mac") || process.env.HOTEL_BUILD_MAC === "1";
const BUILD_LINUX =
  process.argv.includes("--linux") || process.env.HOTEL_BUILD_LINUX === "1";
const BUILD_FR =
  process.argv.includes("--fr") || process.env.HOTEL_BUILD_FR === "1";

if (BUILD_MAC && BUILD_LINUX) {
  console.error("Përdor vetëm një: --mac ose --linux");
  process.exit(1);
}

// tier = legacy cloud/UI (shih package-tier-map.js)
// Pako (pa AI) | Pako AI
const PACKAGES_KS = [
  {
    key: "4",
    tier: "pako_5",
    newTier: "pako_4",
    ai: true,
    suffix: "p4",
    productName: "Revolution HOTEL",
    shortcutName: "Revolution HOTEL",
    artifactName: "Revolution HOTEL Setup.${ext}",
    macArtifactName: "Revolution HOTEL.${ext}",
    linuxArtifactName: "Revolution HOTEL.${ext}",
    guid: "c0a1b2d3-4e5f-6789-a012-334455667704",
  },
];

const PACKAGES_FR = [
  {
    key: "4",
    tier: "pako_5",
    newTier: "pako_4",
    ai: true,
    suffix: "fr.p4",
    productName: "Revolution HOTEL France",
    shortcutName: "Revolution HOTEL France",
    artifactName: "Revolution HOTEL France Setup.${ext}",
    macArtifactName: "Revolution HOTEL France.${ext}",
    linuxArtifactName: "Revolution HOTEL France.${ext}",
    guid: "c0a1b2d3-4e5f-6789-a012-33445566f704",
  },
];

const PACKAGES = BUILD_FR ? PACKAGES_FR : PACKAGES_KS;

const DEFAULT_TIER = { tier: "pako_5", newTier: "pako_4", ai: true, label: "4" };
const DEFAULT_REGION = {
  region: "ks",
  locale: "sq",
  appName: "Revolution HOTEL",
  appId: "com.revolution.hotel",
  currencySymbol: "€",
  htmlLang: "sq",
};
const baseBuild = require("./package.json").build || {};

function platformLabel() {
  const region = BUILD_FR ? "FR" : "KS";
  if (BUILD_MAC) return `macOS dmg [${region}]`;
  if (BUILD_LINUX) return `Linux AppImage [${region}]`;
  return `Windows nsis [${region}]`;
}

function writeTierFile(dir, { tier, label, newTier, ai }) {
  const payload = {
    tier,
    label: String(label),
    newTier: newTier || null,
    ai: ai === true,
  };
  const body =
    "/** Tier baked by build-packages.js (tier=legacy cloud/UI, newTier=Pako 1–4) */\n" +
    "module.exports = " +
    JSON.stringify(payload, null, 2) +
    ";\n";
  fs.writeFileSync(path.join(dir, "package-tier.js"), body, "utf8");
}

function writeRegionFile(dir, region) {
  const body =
    "/** Region — baked by build-packages.js */\n" +
    "module.exports = " +
    JSON.stringify(region, null, 2) +
    ";\n";
  fs.writeFileSync(path.join(dir, "region-config.js"), body, "utf8");
}

function regionForBuild() {
  if (!BUILD_FR) return { ...DEFAULT_REGION };
  return {
    region: "fr",
    locale: "fr",
    appName: "Revolution HOTEL France",
    appId: "com.revolution.hotel.fr",
    currencySymbol: "€",
    htmlLang: "fr",
  };
}

function rimraf(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function prepareObfuscatedBuild() {
  console.log("\n=== Obfuskim (prepare-only) ===");
  execFileSync(process.execPath, [OBFUSCATE_SCRIPT, "HOTEL", "--prepare-only"], {
    cwd: path.join(ROOT, ".."),
    stdio: "inherit",
  });
  if (!fs.existsSync(PROTECTED_DIR)) {
    throw new Error("Mungon .protected-build pas obfuskimit.");
  }
}

function copyArtifact(src, dest) {
  try {
    fs.copyFileSync(src, dest);
    console.log(`  → dist/${path.basename(dest)}`);
  } catch (err) {
    if (err.code === "EBUSY" || err.code === "EPERM") {
      const alt = `${dest}.new`;
      fs.copyFileSync(src, alt);
      console.warn(
        `  ! dist/${path.basename(dest)} locked — saved as dist/${path.basename(alt)}`,
      );
      return;
    }
    throw err;
  }
}

function buildOne(pkg) {
  const region = regionForBuild();
  writeTierFile(ROOT, {
    tier: pkg.tier,
    label: pkg.key,
    newTier: pkg.newTier,
    ai: pkg.ai,
  });
  writeTierFile(PROTECTED_DIR, {
    tier: pkg.tier,
    label: pkg.key,
    newTier: pkg.newTier,
    ai: pkg.ai,
  });
  writeRegionFile(ROOT, region);
  writeRegionFile(PROTECTED_DIR, region);

  const files = Array.from(
    new Set([
      ...(baseBuild.files || []),
      "package-tier.js",
      "region-config.js",
      "i18n.js",
      "locales/**/*",
    ]),
  );

  const config = {
    ...baseBuild,
    appId: `com.revolution.hotel.${pkg.suffix}`,
    productName: pkg.productName,
    files,
    directories: { output: "dist" },
    asar: true,
    // Mbrojtje maksimale Electron (asar integrity + no NODE_OPTIONS/inspect)
    electronFuses: {
      runAsNode: false,
      enableCookieEncryption: true,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      ...(baseBuild.electronFuses || {}),
    },
  };

  if (BUILD_MAC) {
    config.mac = {
      target: ["dmg"],
      category: "public.app-category.business",
      icon: "build/icon.png",
      identity: null,
      hardenedRuntime: false,
      gatekeeperAssess: false,
    };
    config.dmg = {
      artifactName: pkg.macArtifactName,
      title: pkg.productName,
      contents: [
        { x: 130, y: 220 },
        { x: 410, y: 220, type: "link", path: "/Applications" },
      ],
    };
  } else if (BUILD_LINUX) {
    config.linux = {
      target: ["AppImage"],
      category: "Office",
      icon: "build/icon.png",
      executableName: pkg.productName.replace(/\s+/g, "-"),
    };
    config.appImage = {
      artifactName: pkg.linuxArtifactName,
    };
  } else if (process.env.HOTEL_DIR_ONLY === "1") {
    // Portable folder only (faster) — used by VeraCrypt USB packer.
    config.win = { ...(baseBuild.win || {}), target: ["dir"] };
  } else {
    config.win = { ...(baseBuild.win || {}), target: "nsis" };
    config.nsis = {
      ...(baseBuild.nsis || {}),
      oneClick: true,
      perMachine: true,
      allowToChangeInstallationDirectory: false,
      allowElevation: true,
      runAfterFinish: true,
      displayLanguageSelector: false,
      createDesktopShortcut: "always",
      createStartMenuShortcut: true,
      shortcutName: "Revolution HOTEL",
      artifactName: pkg.artifactName,
      guid: pkg.guid,
      include: "build/installer.nsh",
      installerIcon: "build/icon.ico",
      uninstallerIcon: "build/icon.ico",
      installerHeaderIcon: "build/icon.ico",
    };
  }

  const tierConfigFile = path.join(PROTECTED_DIR, "electron-builder.tier.json");
  fs.writeFileSync(tierConfigFile, JSON.stringify(config, null, 2), "utf8");

  const protectedDist = path.join(PROTECTED_DIR, "dist");
  rimraf(protectedDist);

  console.log(
    `\n=== Ndërtimi: ${pkg.productName} (${pkg.tier}) [${platformLabel()}] ===`,
  );
  const ebCli = path.join(
    PROTECTED_DIR,
    "node_modules",
    "electron-builder",
    "out",
    "cli",
    "cli.js",
  );
  const ebCliFallback = path.join(
    ROOT,
    "node_modules",
    "electron-builder",
    "out",
    "cli",
    "cli.js",
  );
  const cli = fs.existsSync(ebCli) ? ebCli : ebCliFallback;

  let ebArgs;
  if (BUILD_MAC) {
    // Artifact-only CI (no GitHub Release publish) — ignore package.json publish
    ebArgs = [cli, "--mac", "--publish", "never", "--config", tierConfigFile];
  } else if (BUILD_LINUX) {
    ebArgs = [
      cli,
      "--linux",
      "--x64",
      "--publish",
      "never",
      "--config",
      tierConfigFile,
    ];
  } else {
    /* CI: mos publiko mid-build (softprops e bën në fund) — shmang draft/untagged */
    ebArgs = [cli, "--win", "--x64", "--publish", "never", "--config", tierConfigFile];
  }

  execFileSync(process.execPath, ebArgs, {
    cwd: PROTECTED_DIR,
    stdio: "inherit",
    env: {
      ...process.env,
      ...(BUILD_MAC ? { CSC_IDENTITY_AUTO_DISCOVERY: "false" } : {}),
    },
  });

  fs.mkdirSync(DIST_DIR, { recursive: true });
  if (!fs.existsSync(protectedDist)) {
    throw new Error(`Nuk u gjet dist për ${pkg.productName}`);
  }

  if (BUILD_MAC) {
    const artifactDmg = pkg.macArtifactName.replace("${ext}", "dmg");
    const src = path.join(protectedDist, artifactDmg);
    if (!fs.existsSync(src)) {
      throw new Error(`Mungon ${artifactDmg}`);
    }
    copyArtifact(src, path.join(DIST_DIR, artifactDmg));
  } else if (BUILD_LINUX) {
    const artifactApp = pkg.linuxArtifactName.replace("${ext}", "AppImage");
    const src = path.join(protectedDist, artifactApp);
    if (!fs.existsSync(src)) {
      throw new Error(`Mungon ${artifactApp}`);
    }
    copyArtifact(src, path.join(DIST_DIR, artifactApp));
  } else {
    // Portable i hapur (DLL) — VETËM staging i brendshëm, JO dist/ Desktop/USB klienti.
    // VeraCrypt USB: lexo nga .portable-internal, jo nga dist/.
    const unpackedSrc = path.join(protectedDist, "win-unpacked");
    const internalPortable = path.join(ROOT, "..", ".portable-internal");
    if (fs.existsSync(unpackedSrc)) {
      rimraf(internalPortable);
      fs.cpSync(unpackedSrc, internalPortable, { recursive: true });
      console.log("  → .portable-internal/ (JO dorëzim — vetëm staging)");
    }
    // Hiq çdo folder Electron të hapur që ka mbetur gabimisht në dist/
    const strayUnpacked = path.join(DIST_DIR, "win-unpacked");
    if (fs.existsSync(strayUnpacked)) {
      rimraf(strayUnpacked);
      console.log("  − hequr dist/win-unpacked (thyente mbrojtjen e dorëzimit)");
    }

    if (process.env.HOTEL_DIR_ONLY === "1") {
      return;
    }

    const artifactExe = pkg.artifactName.replace("${ext}", "exe");
    const artifactBlockmap = `${artifactExe}.blockmap`;
    for (const name of [artifactExe, artifactBlockmap]) {
      const src = path.join(protectedDist, name);
      if (fs.existsSync(src)) copyArtifact(src, path.join(DIST_DIR, name));
    }
    if (
      !fs.existsSync(path.join(DIST_DIR, artifactExe)) &&
      !fs.existsSync(path.join(DIST_DIR, `${artifactExe}.new`))
    ) {
      throw new Error(`Mungon ${artifactExe}`);
    }
  }
}

function cleanup() {
  rimraf(PROTECTED_DIR);
  try {
    const leftover = path.join(ROOT, "electron-builder.tier.json");
    if (fs.existsSync(leftover)) fs.unlinkSync(leftover);
  } catch {
    /* ignore */
  }
  writeTierFile(ROOT, DEFAULT_TIER);
  writeRegionFile(ROOT, DEFAULT_REGION);
}

function main() {
  const requested = process.argv
    .slice(2)
    .map((s) => s.trim())
    .filter((s) => s && s !== "--mac" && s !== "--linux" && s !== "--fr")
    .map((s) => (s === "3" ? "4" : s));
  const allPackages = [...PACKAGES];
  const selected = requested.length
    ? allPackages.filter((p) => requested.includes(p.key))
    : allPackages;

  if (!selected.length) {
    console.error(
      "Asnjë paketë. Vetëm një Setup: Pako 4 (Pako 3 ndryshohet nga telefoni).",
    );
    process.exit(1);
  }

  try {
    cleanDistBeforeBuild(DIST_DIR, "Revolution HOTEL");
    writeTierFile(ROOT, {
      tier: selected[0].tier,
      label: selected[0].key,
      newTier: selected[0].newTier,
      ai: selected[0].ai,
    });
    writeRegionFile(ROOT, regionForBuild());
    prepareObfuscatedBuild();
    writeRegionFile(PROTECTED_DIR, regionForBuild());
    writeTierFile(PROTECTED_DIR, {
      tier: selected[0].tier,
      label: selected[0].key,
      newTier: selected[0].newTier,
      ai: selected[0].ai,
    });
    if (BUILD_FR) {
      const { bakeFrUi } = require("./locales/bake-fr-ui");
      const baked = bakeFrUi(PROTECTED_DIR);
      console.log(
        `\n=== Bake FR UI: ${baked.changed}/${baked.files} files, ${baked.keys} keys ===`,
      );
    }
    for (const pkg of selected) buildOne(pkg);
    console.log(`\n✔ Të gjitha paketat u ndërtuan në dist/ (${platformLabel()}).`);
    finalizeDistDelivery({
      distDir: DIST_DIR,
      projectId: "HOTEL",
      projectPrefix: "Revolution HOTEL",
      desktopPrimary: "Revolution HOTEL Setup.exe",
    });
  } finally {
    cleanup();
  }
}

main();
