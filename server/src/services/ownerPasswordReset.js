const { randomInt } = require("crypto");
const bcrypt = require("bcryptjs");
const { getSupabase } = require("../db");
const { findUserByEmail } = require("./licenseService");
const { isEmailConfigured, sendOwnerPasswordResetEmail } = require("./emailService");
const {
  FAIL_THRESHOLD,
  CHALLENGE_TTL_MS,
  MIN_PASSWORD,
  normalizeEmail,
  incrementFailCount,
  clearFailCount,
} = require("./ownerLoginFailures");

function sixDigitCode() {
  return String(randomInt(100_000, 1_000_000));
}

function isResettableOwner(user) {
  return (
    user &&
    user.roli === "client_admin" &&
    user.passwordi &&
    user.aktiv !== false &&
    user.client_id
  );
}

async function storeResetChallenge(email, codeHash) {
  const db = getSupabase();
  const e = normalizeEmail(email);
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();

  await db.from("owner_password_resets").delete().eq("email", e);

  const { error } = await db.from("owner_password_resets").insert({
    email: e,
    code_hash: codeHash,
    expires_at: expiresAt,
  });

  if (error) {
    throw new Error(
      "Tabela owner_password_resets mungon. Ekzekutoni supabase/migrations/008_owner_password_reset.sql",
    );
  }
}

async function sendOwnerResetChallenge(email) {
  if (!isEmailConfigured()) {
    throw new Error("EMAIL_NOT_CONFIGURED");
  }
  const code = sixDigitCode();
  const codeHash = await bcrypt.hash(code, 10);
  await storeResetChallenge(email, codeHash);
  await sendOwnerPasswordResetEmail({ to: email, code });
}

async function handleOwnerWrongPassword(user, email) {
  let failCount = 1;
  try {
    failCount = await incrementFailCount(email);
  } catch (err) {
    console.error("[owner-login] fail count DB error:", err.message);
  }

  const remaining = FAIL_THRESHOLD - failCount;

  if (failCount >= FAIL_THRESHOLD && isResettableOwner(user) && isEmailConfigured()) {
    try {
      await sendOwnerResetChallenge(email);
      return {
        gabim: "Fjalëkalim i gabuar. Ta dërguam një kod për rivendosje fjalëkalimi në email.",
        code: "PASSWORD_RESET_SENT",
        fail_count: failCount,
        password_reset_sent: true,
      };
    } catch (err) {
      console.error("[owner-login] reset email failed:", err.message);
    }
  }

  const message =
    remaining > 0
      ? `Fjalëkalim i gabuar. Pas ${remaining} përpjekje${remaining === 1 ? "je" : "sh"} të tjera do ta dërgojmë kodin e rivendosjes në email.`
      : "Fjalëkalim i gabuar.";

  return {
    gabim: message,
    code: "INVALID_CREDENTIALS",
    fail_count: failCount,
  };
}

async function requestOwnerPasswordReset(email) {
  const e = normalizeEmail(email);
  if (!e) throw new Error("Email i detyrueshëm.");

  const generic = {
    ok: true,
    message: "Nëse ky email është i regjistruar, do të marrësh një kod.",
  };

  const user = await findUserByEmail(e);
  if (!isResettableOwner(user)) return generic;

  if (!isEmailConfigured()) {
    throw new Error("EMAIL_NOT_CONFIGURED");
  }

  await sendOwnerResetChallenge(e);
  return generic;
}

async function completeOwnerPasswordReset(email, code, newPassword) {
  const e = normalizeEmail(email);
  const c = String(code || "").trim();
  const pw = String(newPassword || "").trim();

  if (!e || c.length < 4 || pw.length < MIN_PASSWORD) {
    throw new Error(`Email, kodi dhe fjalëkalimi i ri (min ${MIN_PASSWORD} karaktere) kërkohen.`);
  }

  const user = await findUserByEmail(e);
  if (!isResettableOwner(user)) {
    throw new Error("Llogaria nuk u gjet ose nuk është e aktivizuar.");
  }

  const db = getSupabase();
  const nowIso = new Date().toISOString();

  const { data: challenge, error: findErr } = await db
    .from("owner_password_resets")
    .select("*")
    .eq("email", e)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findErr) throw findErr;
  if (!challenge) {
    const err = new Error("Kodi ka skaduar. Kërkoni kod të ri.");
    err.code = "CODE_EXPIRED";
    throw err;
  }

  const ok = await bcrypt.compare(c, challenge.code_hash);
  if (!ok) {
    const err = new Error("Kodi është i gabuar. Provo përsëri.");
    err.code = "INVALID_CODE";
    throw err;
  }

  const hash = await bcrypt.hash(pw, 12);
  const { error: updErr } = await db
    .from("users")
    .update({
      passwordi: hash,
      password_set_at: nowIso,
    })
    .eq("id", user.id);

  if (updErr) throw updErr;

  await db.from("owner_password_resets").delete().eq("email", e);
  await clearFailCount(e);

  return user;
}

/**
 * Ndryshim fjalëkalimi kur pronari është i kyçur (telefon ose panel web).
 * I njëjti hash në `users.passwordi` — vlen për të dyja.
 */
async function changeOwnerPassword(userId, currentPassword, newPassword) {
  const id = String(userId || "").trim();
  const current = String(currentPassword || "");
  const next = String(newPassword || "").trim();

  if (!id) {
    const err = new Error("Sesioni nuk është i vlefshëm.");
    err.code = "UNAUTHORIZED";
    throw err;
  }
  if (!current) {
    const err = new Error("Shkruani fjalëkalimin aktual.");
    err.code = "CURRENT_REQUIRED";
    throw err;
  }
  if (next.length < MIN_PASSWORD) {
    const err = new Error(`Fjalëkalimi i ri duhet min. ${MIN_PASSWORD} karaktere.`);
    err.code = "WEAK_PASSWORD";
    throw err;
  }
  if (current === next) {
    const err = new Error("Fjalëkalimi i ri duhet të jetë i ndryshëm nga aktual.");
    err.code = "SAME_PASSWORD";
    throw err;
  }

  const db = getSupabase();
  const { data: user, error } = await db
    .from("users")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!isResettableOwner(user)) {
    const err = new Error("Llogaria nuk u gjet ose nuk është e aktivizuar.");
    err.code = "NOT_FOUND";
    throw err;
  }

  const ok = await bcrypt.compare(current, user.passwordi);
  if (!ok) {
    const err = new Error("Fjalëkalimi aktual është i gabuar.");
    err.code = "INVALID_CURRENT";
    throw err;
  }

  const hash = await bcrypt.hash(next, 12);
  const nowIso = new Date().toISOString();
  const { error: updErr } = await db
    .from("users")
    .update({
      passwordi: hash,
      password_set_at: nowIso,
    })
    .eq("id", user.id);
  if (updErr) throw updErr;

  await clearFailCount(user.email);
  return user;
}

module.exports = {
  FAIL_THRESHOLD,
  MIN_PASSWORD,
  clearFailCount,
  handleOwnerWrongPassword,
  requestOwnerPasswordReset,
  completeOwnerPasswordReset,
  changeOwnerPassword,
  isEmailConfigured,
};
