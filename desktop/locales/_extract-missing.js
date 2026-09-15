const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const existing = require("./fr-map.js");

function extract(file) {
  const html = fs.readFileSync(path.join(root, file), "utf8");
  const re = />\s*([^<]{2,140}?)\s*</g;
  const set = new Set();
  let m;
  while ((m = re.exec(html))) {
    let t = m[1]
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!t || t.length < 2) continue;
    if (/^[\d\s€.,:%\-–—\/]+$/.test(t)) continue;
    if (t.includes("${")) continue;
    set.add(t);
  }
  return [...set];
}

const files = [
  "public/admin.html",
  "public/login.html",
  "public/waiter.html",
  "public/setup.html",
];
const all = new Set();
for (const f of files) extract(f).forEach((t) => all.add(t));
const missing = [...all]
  .filter((s) => existing[s] == null)
  .sort((a, b) => b.length - a.length);
fs.writeFileSync(path.join(__dirname, "_admin-missing.txt"), missing.join("\n"), "utf8");
console.log("all unique", all.size, "missing", missing.length);
console.log(missing.join("\n"));
