/**
 * Bake French into UI files for HOTEL France builds.
 * ONLY exact full-string replacements (literals + HTML text) — never partial/substring.
 */
const fs = require("fs");
const path = require("path");

function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, exts, out);
    else if (exts.has(path.extname(name).toLowerCase())) out.push(p);
  }
  return out;
}

function bakeContent(src, map) {
  let out = src;

  // 1) Exact "..." and '...' string literals (UI messages in JS)
  out = out.replace(/(["'])([^"'\\\n]*(?:\\.[^"'\\\n]*)*)\1/g, (full, q, inner) => {
    if (Object.prototype.hasOwnProperty.call(map, inner)) {
      const val = String(map[inner]).replace(/\\/g, "\\\\").replace(new RegExp(q, "g"), "\\" + q);
      return q + val + q;
    }
    return full;
  });

  // 2) Exact `...` template literals without ${}
  out = out.replace(/`([^`$\\]*(?:\\.[^`$\\]*)*)`/g, (full, inner) => {
    if (inner.includes("${")) return full;
    if (Object.prototype.hasOwnProperty.call(map, inner)) {
      const val = String(map[inner])
        .replace(/\\/g, "\\\\")
        .replace(/`/g, "\\`")
        .replace(/\$/g, "\\$");
      return "`" + val + "`";
    }
    return full;
  });

  // 3) HTML text between tags (exact trimmed match)
  out = out.replace(/>([^<]+)</g, (full, text) => {
    const trim = text.trim();
    if (!trim) return full;
    if (Object.prototype.hasOwnProperty.call(map, trim)) {
      return ">" + text.replace(trim, map[trim]) + "<";
    }
    const decoded = trim.replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
    if (decoded !== trim && Object.prototype.hasOwnProperty.call(map, decoded)) {
      const fr = String(map[decoded]).replace(/&/g, "&amp;");
      return ">" + text.replace(trim, fr) + "<";
    }
    return full;
  });

  // 4) Common attributes
  out = out.replace(
    /\b(placeholder|title|aria-label)=(["'])([^"']*)\2/gi,
    (full, attr, q, val) => {
      if (Object.prototype.hasOwnProperty.call(map, val)) {
        return `${attr}=${q}${map[val]}${q}`;
      }
      return full;
    },
  );

  return out;
}

function bakeFrUi(rootDir) {
  const map = require(path.join(rootDir, "locales", "fr-map.js"));
  const targets = [
    ...walk(path.join(rootDir, "public"), new Set([".html", ".js"])),
  ];
  let files = 0;
  let changed = 0;
  for (const file of targets) {
    const before = fs.readFileSync(file, "utf8");
    const after = bakeContent(before, map);
    files++;
    if (after !== before) {
      fs.writeFileSync(file, after, "utf8");
      changed++;
    }
  }
  return { files, changed, keys: Object.keys(map).length };
}

module.exports = { bakeFrUi, bakeContent };

if (require.main === module) {
  const root = process.argv[2] || path.join(__dirname, "..");
  const r = bakeFrUi(root);
  console.log("bake-fr-ui", r);
}
