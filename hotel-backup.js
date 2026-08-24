/**
 * hotel-backup.js — kopjim i plotë i folderit Revolution HOTEL
 * Ky skedar NUK obfuskohet.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

function getHotelDataDir() {
  if (process.env.DB_PATH) return path.dirname(process.env.DB_PATH);
  return path.join(os.homedir(), "AppData", "Roaming", "Revolution HOTEL");
}

function stampDirName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `revolution-hotel-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_` +
    `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}

const CRYPTO_SIDECARS = [".db-master.dpapi", ".db-master.scrypt", ".db-install-salt"];

function stampMigrationBackupName(migrationId) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const safeId = String(migrationId || "migration").replace(/[^\w-]+/g, "-");
  return (
    `pre-${safeId}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_` +
    `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}

/**
 * Snapshot i databazës para migrimit destruktiv (DROP/RENAME).
 * Ruhet te {dataDir}/migration-backups/pre-<id>-<timestamp>/
 * @throws nëse kopjimi dështon ose backup-i del bosh
 */
function createPreMigrationBackup({ migrationId, dbPath, flushSave, exportPlain } = {}) {
  const resolvedPath = dbPath || path.join(getHotelDataDir(), "hotel.db");
  const dataDir = path.dirname(resolvedPath);
  if (typeof flushSave === "function") flushSave();

  if (!fs.existsSync(resolvedPath)) {
    throw new Error("Skedari i databazës nuk u gjet: " + resolvedPath);
  }

  const backupRoot = path.join(dataDir, "migration-backups");
  fs.mkdirSync(backupRoot, { recursive: true });
  const destDir = path.join(backupRoot, stampMigrationBackupName(migrationId));
  fs.mkdirSync(destDir, { recursive: true });

  const dbCopy = path.join(destDir, path.basename(resolvedPath));
  fs.copyFileSync(resolvedPath, dbCopy);
  if (!fs.statSync(dbCopy).size) {
    throw new Error("Backup i databazës doli bosh.");
  }

  for (const name of CRYPTO_SIDECARS) {
    const src = path.join(dataDir, name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(destDir, name));
    }
  }

  let plainPath = null;
  if (typeof exportPlain === "function") {
    const plain = exportPlain();
    if (plain && plain.length) {
      plainPath = path.join(destDir, "pre-migration.plain.sqlite");
      fs.writeFileSync(plainPath, plain);
    }
  }

  const manifest = {
    migration_id: migrationId || "unknown",
    created_at: new Date().toISOString(),
    source_db: resolvedPath,
    backup_dir: destDir,
    plain_sqlite: plainPath,
    files: fs.readdirSync(destDir),
  };
  fs.writeFileSync(path.join(destDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return destDir;
}

function copyEntry(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyEntry(path.join(src, name), path.join(dest, name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function listCopiedFiles(dir, base = dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(base, full);
    const st = fs.statSync(full);
    if (st.isDirectory()) listCopiedFiles(full, base, out);
    else out.push(rel);
  }
  return out;
}

/**
 * Kopjon krejt %APPDATA%\Revolution HOTEL\ në targetParent/revolution-hotel-backup-<timestamp>/
 */
function runBackup(targetParentDir) {
  const parent = String(targetParentDir || "").trim();
  if (!parent) throw new Error("Folderi i backup-it mungon");

  const srcDir = getHotelDataDir();
  if (!fs.existsSync(srcDir)) {
    throw new Error("Folderi i databazës nuk u gjet: " + srcDir);
  }

  try {
    const db = require("./database");
    if (typeof db.flushDatabase === "function") {
      db.flushDatabase();
    }
  } catch (e) {
    console.warn("[hotel-backup] flushDatabase:", e.message);
  }

  const destDir = path.join(parent, stampDirName());
  fs.mkdirSync(destDir, { recursive: true });

  for (const name of fs.readdirSync(srcDir)) {
    copyEntry(path.join(srcDir, name), path.join(destDir, name));
  }

  const files = listCopiedFiles(destDir);
  const createdAt = new Date().toISOString();

  return {
    ok: true,
    source_dir: srcDir,
    dest_dir: destDir,
    created_at: createdAt,
    file_count: files.length,
    files,
  };
}

function pickBackupFolderDialog() {
  try {
    const { dialog, BrowserWindow } = require("electron");
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
    const result = dialog.showOpenDialogSync(win, {
      title: "Backup — zgjidh folder (USB, Desktop, …)",
      properties: ["openDirectory", "createDirectory"],
    });
    if (!result || !result[0]) return null;
    return result[0];
  } catch {
    return null;
  }
}

module.exports = {
  getHotelDataDir,
  runBackup,
  pickBackupFolderDialog,
  createPreMigrationBackup,
};
