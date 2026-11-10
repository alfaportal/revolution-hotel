const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const IMPORT_EXTS = new Set([".csv", ".xlsx", ".xls"]);
const MAX_USB_FILES = 400;
const MAX_FOLDER_DEPTH = 1;
const SKIP_DIR_NAMES = new Set([
  "system volume information",
  "$recycle.bin",
  "recycler",
  "found.000",
  "node_modules",
  ".git",
]);

function logStep(scanLog, message) {
  const line = String(message || "");
  scanLog.push(line);
  console.log(`[product-import-usb] ${line}`);
}

function listNonSystemDriveLetters(scanLog) {
  const drives = [];
  logStep(scanLog, "Drives: checking D: through Z: (all types, skip C:)");
  for (let code = 68; code <= 90; code += 1) {
    const letter = `${String.fromCharCode(code)}:`;
    const root = `${letter}\\`;
    try {
      fs.accessSync(root, fs.constants.R_OK);
      drives.push(letter);
      logStep(scanLog, `Drive ${letter} accessible`);
    } catch {
      logStep(scanLog, `Drive ${letter} skip (not accessible)`);
    }
  }
  return drives;
}

function isImportExtension(filePath) {
  return IMPORT_EXTS.has(path.extname(String(filePath || "")).toLowerCase());
}

function scanFolderImportFiles(folderDir, driveLetter, out, depth, scanLog) {
  if (out.length >= MAX_USB_FILES) return;
  if (depth > MAX_FOLDER_DEPTH) return;
  logStep(scanLog, `Scan folder depth=${depth}: ${folderDir}`);
  let entries;
  try {
    entries = fs.readdirSync(folderDir, { withFileTypes: true });
  } catch (e) {
    logStep(scanLog, `Skip folder (error): ${folderDir} — ${e.message || e}`);
    return;
  }
  for (const ent of entries) {
    if (out.length >= MAX_USB_FILES) break;
    const name = ent.name;
    const full = path.join(folderDir, name);
    if (ent.isDirectory()) {
      if (SKIP_DIR_NAMES.has(String(name).toLowerCase())) {
        logStep(scanLog, `Skip system dir: ${full}`);
        continue;
      }
      if (depth < MAX_FOLDER_DEPTH) {
        scanFolderImportFiles(full, driveLetter, out, depth + 1, scanLog);
      }
      continue;
    }
    if (!ent.isFile()) continue;
    if (!isImportExtension(full)) continue;
    let stat;
    try {
      stat = fs.statSync(full);
    } catch (e) {
      logStep(scanLog, `Skip file (stat): ${full} — ${e.message || e}`);
      continue;
    }
    logStep(scanLog, `Found: ${full} (${stat.size} bytes)`);
    out.push({
      drive: driveLetter,
      filename: name,
      path: full,
      size: stat.size,
      modified: stat.mtime.toISOString(),
      modified_local: stat.mtime.toLocaleString("sq-AL", { hour12: false }),
    });
  }
}

function scanUsbImportFiles() {
  const scanLog = [];
  const drives = listNonSystemDriveLetters(scanLog);
  const files = [];
  for (const drive of drives) {
    const root = `${drive}\\`;
    scanFolderImportFiles(root, drive, files, 0, scanLog);
  }
  files.sort((a, b) => {
    const dc = String(a.drive).localeCompare(String(b.drive));
    if (dc !== 0) return dc;
    return String(a.filename).localeCompare(String(b.filename));
  });
  logStep(scanLog, `Done: ${drives.length} drive(s), ${files.length} file(s)`);
  return { drives, files, log: scanLog };
}

function normalizeDriveLetter(letter) {
  const L = String(letter || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  if (!L || L.length !== 1) return "";
  const drive = `${L}:`;
  if (drive === "C:") return "";
  return drive;
}

function assertAllowedDriveRoot(drive) {
  const d = normalizeDriveLetter(drive);
  if (!d) throw new Error("Drive i pavlefshëm");
  try {
    fs.accessSync(`${d}\\`, fs.constants.R_OK);
  } catch {
    throw new Error("Drive nuk lexohet");
  }
  return d;
}

function resolvePathUnderExternalDrive(inputPath) {
  const raw = String(inputPath || "").trim();
  if (!raw) throw new Error("Rruga mungon");
  const withSlash = /^[A-Za-z]:$/.test(raw) ? `${raw}\\` : raw;
  const resolved = path.resolve(withSlash);
  const root = path.parse(resolved).root.toUpperCase();
  const drive = root.replace(/\\$/, "");
  if (!/^[A-Z]:$/.test(drive) || drive === "C:") {
    throw new Error("C: nuk lejohet");
  }
  assertAllowedDriveRoot(drive);
  const driveRoot = `${drive}\\`;
  if (!resolved.toUpperCase().startsWith(driveRoot.toUpperCase())) {
    throw new Error("Rruga e pavlefshme");
  }
  return { resolved, drive, driveRoot };
}

function getDriveInfoWin(drive) {
  const letter = assertAllowedDriveRoot(drive);
  let name = "";
  let size = 0;
  try {
    const dl = letter.replace(":", "");
    const ps = `$d=Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DeviceID -eq '${letter}' }; if($d){Write-Output ($d.VolumeName+'|'+$d.Size)}`;
    const out = execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`, {
      encoding: "utf8",
      timeout: 12000,
      windowsHide: true,
    }).trim();
    const parts = out.split("|");
    name = String(parts[0] || "").trim();
    size = Number(parts[1]) || 0;
    if (!name && dl) {
      const ps2 = `$v=Get-Volume -DriveLetter '${dl}' -ErrorAction SilentlyContinue; if($v){$v.FileSystemLabel+'|'+$v.Size}`;
      const out2 = execSync(`powershell -NoProfile -Command "${ps2.replace(/"/g, '\\"')}"`, {
        encoding: "utf8",
        timeout: 12000,
        windowsHide: true,
      }).trim();
      const p2 = out2.split("|");
      if (p2[0]) name = String(p2[0]).trim();
      if (p2[1]) size = Number(p2[1]) || size;
    }
  } catch {
    void 0;
  }
  if (!name) name = letter;
  return { letter, name, size, path: `${letter}\\` };
}

function listImportDrives() {
  const scanLog = [];
  const letters = listNonSystemDriveLetters(scanLog);
  const drives = letters.map((letter) => getDriveInfoWin(letter));
  return { drives, log: scanLog };
}

function formatDisplayPath(resolvedPath) {
  const p = String(resolvedPath || "").replace(/\\+$/, "");
  const parts = p.split("\\").filter(Boolean);
  if (parts.length <= 1) return `${parts[0] || ""}\\`;
  return parts.join(" > ");
}

function browseImportFolder(inputPath) {
  const { resolved, drive, driveRoot } = resolvePathUnderExternalDrive(inputPath);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error("Folderi nuk u gjet");
  }
  if (!stat.isDirectory()) throw new Error("Nuk është folder");
  let entries;
  try {
    entries = fs.readdirSync(resolved, { withFileTypes: true });
  } catch (e) {
    throw new Error(e.message || "Folderi nuk lexohet");
  }
  const items = [];
  for (const ent of entries) {
    const name = ent.name;
    if (SKIP_DIR_NAMES.has(String(name).toLowerCase())) continue;
    const full = path.join(resolved, name);
    if (ent.isDirectory()) {
      items.push({
        name,
        type: "folder",
        extension: "",
        size: 0,
        modified: "",
        modified_local: "",
        path: full,
        selectable: true,
      });
      continue;
    }
    if (!ent.isFile()) continue;
    const ext = path.extname(name).toLowerCase();
    let fstat;
    try {
      fstat = fs.statSync(full);
    } catch {
      continue;
    }
    const importable = isImportExtension(full);
    items.push({
      name,
      type: "file",
      extension: ext.replace(/^\./, ""),
      size: fstat.size,
      modified: fstat.mtime.toISOString(),
      modified_local: fstat.mtime.toLocaleString("sq-AL", { hour12: false }),
      path: full,
      selectable: importable,
    });
  }
  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" });
  });
  const norm = resolved.endsWith("\\") ? resolved : `${resolved}\\`;
  const atDriveRoot = norm.toUpperCase() === driveRoot.toUpperCase();
  let parent = null;
  if (!atDriveRoot) {
    const parentDir = path.dirname(resolved);
    parent = parentDir.endsWith(":") ? `${parentDir}\\` : parentDir;
  }
  return {
    path: norm,
    drive,
    display_path: formatDisplayPath(resolved),
    parent,
    at_drive_root: atDriveRoot,
    items,
  };
}

function assertImportFileOnExternalDrive(filePath) {
  const { resolved } = resolvePathUnderExternalDrive(filePath);
  if (!isImportExtension(resolved)) {
    throw new Error("Format i pavlefshëm — vetëm CSV ose Excel");
  }
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error("Skedari nuk u gjet");
  }
  if (!stat.isFile()) throw new Error("Skedari nuk u gjet");
  const root = path.parse(resolved).root.toUpperCase();
  const drive = root.replace(/\\$/, "");
  return { resolved, stat, drive, filename: path.basename(resolved) };
}

function readUsbImportFileBuffer(filePath) {
  const { resolved, filename } = assertImportFileOnExternalDrive(filePath);
  const buffer = fs.readFileSync(resolved);
  return { buffer, filename };
}

function getRemovableDriveLettersWin() {
  return listNonSystemDriveLetters([]);
}

module.exports = {
  scanUsbImportFiles,
  readUsbImportFileBuffer,
  getRemovableDriveLettersWin,
  assertImportFileOnUsb: assertImportFileOnExternalDrive,
  assertImportFileOnExternalDrive,
  listNonSystemDriveLetters,
  listImportDrives,
  browseImportFolder,
  resolvePathUnderExternalDrive,
};
