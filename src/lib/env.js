const path = require("path");

// Lexo .env nga rrënja e projektit (edhe kur cwd ndryshon)
require("dotenv").config({ path: path.join(__dirname, "../../.env") });
if (!process.env.PRODUCT_LINE) process.env.PRODUCT_LINE = "hotel";

function trimEnv(name) {
  const v = process.env[name];
  return typeof v === "string" ? v.trim() : "";
}

function getSupabaseConfig() {
  const url = trimEnv("SUPABASE_URL");
  const key =
    trimEnv("SUPABASE_SERVICE_ROLE_KEY") ||
    trimEnv("SUPABASE_KEY") ||
    trimEnv("SUPABASE_SERVICE_KEY");

  return { url, key };
}

function maskKey(key) {
  if (!key) return "(mungon)";
  return `set, ${key.length} chars, fillon me ${key.slice(0, 6)}…`;
}

function logEnvStatus() {
  const { url, key } = getSupabaseConfig();
  const jwt = trimEnv("JWT_SECRET");

  console.log("\n  ── Variablat e mjedisit ──");
  console.log(`  SUPABASE_URL:              ${url || "❌ MUNGON"}`);
  console.log(`  SUPABASE_SERVICE_ROLE_KEY: ${maskKey(key)}`);
  console.log(`  PRODUCT_LINE:              ${trimEnv("PRODUCT_LINE") || "hotel"}`);
  console.log(`  JWT_SECRET:                ${jwt ? `set (${jwt.length} chars)` : "❌ MUNGON"}`);
  console.log(`  NODE_ENV:                  ${process.env.NODE_ENV || "development"}`);
  console.log(`  PORT:                      ${process.env.PORT || "8080"}\n`);

  const missing = [];
  if (!url) missing.push("SUPABASE_URL");
  if (!key) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!jwt || jwt.length < 16) missing.push("JWT_SECRET (min 16 karaktere)");

  if (missing.length) {
    console.error(`  ❌ Mungojnë ose janë të pavlefshme: ${missing.join(", ")}`);
    return false;
  }
  return true;
}

module.exports = {
  trimEnv,
  getSupabaseConfig,
  logEnvStatus,
};
