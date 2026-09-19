/**
 * POS (SQLite) dërgon datat pa timezone — Supabase i ruan si UTC dhe KDS +2h.
 * Naive = ora lokale Kosovë/Belgrade (+02/+01); konverto në ISO UTC të saktë.
 */

const BELGRADE_NAIVE_SUFFIX = "+02:00";

function hasExplicitOffset(s) {
  return /Z$/i.test(s) || /[+-]\d{2}:?\d{2}$/.test(String(s).trim());
}

function naiveLocalToIso(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  let t = s.includes("T") ? s : s.replace(" ", "T");
  t = t.replace(/\.\d+$/, "");
  if (t.length === 16) t += ":00";
  const d = new Date(`${t}${BELGRADE_NAIVE_SUFFIX}`);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** Kur POS dërgon ordered_at (SQLite / pa Z). */
function normalizePosOrderedAt(raw, fallbackIso) {
  const fb = fallbackIso || new Date().toISOString();
  const s = String(raw ?? "").trim();
  if (!s) return fb;
  if (hasExplicitOffset(s)) {
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d.toISOString() : fb;
  }
  return naiveLocalToIso(s) || fb;
}

/**
 * Rreshta ekzistues: ordered_at u ruajt si "ora lokale me Z" (UTC gabim).
 * Krahaso me pos_synced_at (UTC i saktë nga serveri) — skew ~2h.
 */
function kdsOrderedAtInstant(order) {
  const oa = order?.ordered_at || order?.created_at;
  if (!oa) return oa;
  const { isPosDesktopDevice } = require("./orderSource");
  if (!isPosDesktopDevice(order?.device_id)) return oa;

  const ps = order?.pos_synced_at;
  if (ps) {
    const skewMs = new Date(oa).getTime() - new Date(ps).getTime();
    const twoH = 2 * 3600000;
    if (skewMs > twoH - 1800000 && skewMs < twoH + 1800000) {
      return new Date(new Date(oa).getTime() - twoH).toISOString();
    }
  }

  return oa;
}

module.exports = {
  normalizePosOrderedAt,
  kdsOrderedAtInstant,
  naiveLocalToIso,
};
