import fs from "fs";
import path from "path";
import { createRequire } from "module";
import os from "os";

const require = createRequire(import.meta.url);
const file = path.resolve("version-config.js");
const tmp = path.join(os.tmpdir(), "version-config-patch.js");
fs.copyFileSync(file, tmp);
let s = fs.readFileSync(tmp, "utf8");

const reps = [
  ['"Sandwiçe / Toast"', '"Sanduiç / Toast"'],
  ['{ name: "Tonic Water", price: 1.5, image: U("soft-tonic-water.jpg") }', '{ name: "Ujë tonik", price: 1.5, image: U("soft-tonic-water.jpg") }'],
  ['{ name: "Ginger Ale", price: 1.5, image: U("soft-ginger-ale.jpg") }', '{ name: "Xhinxher ale", price: 1.5, image: U("soft-ginger-ale.jpg") }'],
  ['{ name: "Soda", price: 1, image: U("soft-soda.jpg") }', '{ name: "Sodë", price: 1, image: U("soft-soda.jpg") }'],
  ['{ name: "Iced Coffee", price: 2, image: U("cold-iced-coffee.jpg") }', '{ name: "Kafe e ftohtë", price: 2, image: U("cold-iced-coffee.jpg") }'],
  ['{ name: "Iced Latte", price: 2.5, image: U("cold-iced-latte.jpg") }', '{ name: "Latte e ftohtë", price: 2.5, image: U("cold-iced-latte.jpg") }'],
  ['{ name: "Cold Brew", price: 2.5, image: U("cold-cold-brew.jpg") }', '{ name: "Kafe e ftohtë e ngadalshme", price: 2.5, image: U("cold-cold-brew.jpg") }'],
  ['{ name: "Iced Mocha", price: 2.5, image: U("cold-iced-mocha.jpg") }', '{ name: "Mocha e ftohtë", price: 2.5, image: U("cold-iced-mocha.jpg") }'],
  ['{ name: "Iced Tea", price: 1.5, image: U("cold-iced-tea.jpg") }', '{ name: "Çaj i ftohtë", price: 1.5, image: U("cold-iced-tea.jpg") }'],
  ['{ name: "Lemonadë", price: 1.5, image: U("cold-lemonade.jpg") }', '{ name: "Limonadë", price: 1.5, image: U("cold-lemonade.jpg") }'],
  ['{ name: "Smoothie banana", price: 3, image: U("cold-smoothie-banana.jpg") }', '{ name: "Smoothie banane", price: 3, image: U("cold-smoothie-banana.jpg") }'],
  ['{ name: "Smoothie strawberry", price: 3, image: U("cold-smoothie-strawberry.jpg") }', '{ name: "Smoothie luleshtrydhe", price: 3, image: U("cold-smoothie-strawberry.jpg") }'],
  ['{ name: "Milkshake vanilj", price: 3, image: U("cold-milkshake-vanilj.jpg") }', '{ name: "Milkshake vanilje", price: 3, image: U("cold-milkshake-vanilj.jpg") }'],
  ['{ name: "Milkshake strawberry", price: 3, image: U("cold-milkshake-strawberry.jpg") }', '{ name: "Milkshake luleshtrydhe", price: 3, image: U("cold-milkshake-strawberry.jpg") }'],
];

let n = 0;
for (const [a, b] of reps) {
  if (s.includes(a)) {
    s = s.split(a).join(b);
    n++;
  } else {
    console.log("MISS:", a.slice(0, 60));
  }
}
fs.writeFileSync(tmp, s);
try {
  fs.copyFileSync(tmp, file);
} catch (e) {
  console.error("copy failed:", e.message);
  console.log("Patched file at:", tmp);
  process.exit(1);
}
console.log("replaced", n);
const V = require("../version-config");
console.log("seed count", V.menuSeedRaw.length);
