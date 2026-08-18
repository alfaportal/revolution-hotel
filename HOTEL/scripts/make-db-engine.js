const fs = require("fs");
const path = require("path");

const workerPath = path.join(__dirname, "..", "db-rpc-worker.js");
const outPath = path.join(__dirname, "..", "db-engine.js");
const lines = fs.readFileSync(workerPath, "utf8").split(/\n/);

// Find initSchema function through end of initSchema (line with "  }" before "  function reply")
let schemaStart = -1;
let schemaEnd = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].match(/^\s*function initSchema\(\)/)) schemaStart = i;
  if (schemaStart >= 0 && i > schemaStart && lines[i].match(/^\s*function reply\(/)) {
    schemaEnd = i;
    break;
  }
}
if (schemaStart < 0 || schemaEnd < 0) {
  console.error("initSchema not found", schemaStart, schemaEnd);
  process.exit(1);
}

// Dedent schema body (remove 2 leading spaces if present)
const schemaFn = lines
  .slice(schemaStart, schemaEnd)
  .map((l) => (l.startsWith("  ") ? l.slice(2) : l))
  .join("\n");

const out = `"use strict";
/**
 * sql.js in-process për Electron — pa Worker / pa Atomics.wait.
 */
const fs = require("fs");
const path = require("path");

let VERSION = { defaultCategories: ["Pije", "Ushqim", "Të tjera"] };
try {
  VERSION = require("./version-config");
} catch (_) {}

function localeLayoutLabels() {
  let fr = false;
  try {
    fr = require("./i18n").isFrench();
  } catch {
    fr = false;
  }
  return {
    mainZone: fr ? "Principale" : "Kryesore",
    onlineZone: fr ? "Commandes en ligne" : "Porosi online",
    tablePrefix: fr ? "Table " : "Tavolina ",
  };
}

async function bootDatabase(cfg) {
  const initSqlJs = require("sql.js");
  const dbPath = cfg.dbPath;
  const baseDir = cfg.baseDir || __dirname;
  let db;
  let inTx = false;

  function saveDb() {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
  }

  function getLastInsertRowid() {
    const stmt = db.prepare("SELECT last_insert_rowid() AS id");
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();
    return row.id;
  }

  function sqlGet(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      if (params.length) stmt.bind(params);
      if (stmt.step()) return stmt.getAsObject();
      return undefined;
    } finally {
      stmt.free();
    }
  }

  function sqlAll(sql, params = []) {
    const stmt = db.prepare(sql);
    const rows = [];
    try {
      if (params.length) stmt.bind(params);
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  function sqlRun(sql, params = []) {
    if (params.length) db.run(sql, params);
    else db.run(sql);
    const result = { lastInsertRowid: getLastInsertRowid(), changes: db.getRowsModified() };
    if (!inTx) saveDb();
    return result;
  }

  function sqlExec(sql) {
    db.exec(sql);
    if (!inTx) saveDb();
  }

${schemaFn}

  const wasmCandidates = [];
  if (cfg.wasmDir) wasmCandidates.push(cfg.wasmDir);
  if (cfg.resourcesPath) {
    wasmCandidates.push(
      path.join(cfg.resourcesPath, "app.asar.unpacked", "node_modules", "sql.js", "dist"),
    );
  }
  wasmCandidates.push(path.join(baseDir, "node_modules", "sql.js", "dist"));
  wasmCandidates.push(path.join(__dirname, "node_modules", "sql.js", "dist"));

  const SQL = await initSqlJs({
    locateFile: (file) => {
      for (const dir of wasmCandidates) {
        const p = path.join(dir, file);
        if (fs.existsSync(p)) return p;
      }
      return path.join(wasmCandidates[0] || __dirname, file);
    },
  });

  if (fs.existsSync(dbPath)) {
    db = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    db = new SQL.Database();
  }
  initSchema();
  saveDb();

  function dispatch(msg) {
    switch (msg.op) {
      case "get":
        return sqlGet(msg.sql, msg.params);
      case "all":
        return sqlAll(msg.sql, msg.params);
      case "run":
        return sqlRun(msg.sql, msg.params);
      case "exec":
        sqlExec(msg.sql);
        return undefined;
      case "begin":
        inTx = true;
        db.run("BEGIN");
        return undefined;
      case "commit":
        db.run("COMMIT");
        inTx = false;
        saveDb();
        return undefined;
      case "rollback":
        db.run("ROLLBACK");
        inTx = false;
        saveDb();
        return undefined;
      default:
        throw new Error("Unknown db op: " + msg.op);
    }
  }

  return { dispatch };
}

module.exports = { bootDatabase };
`;

fs.writeFileSync(outPath, out);
console.log("OK", outPath, "bytes", out.length, "schema lines", schemaEnd - schemaStart);
