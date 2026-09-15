const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { getSupabase } = require("../db");
const { isEmailConfigured, sendOwnerInviteEmail } = require("./emailService");

const INVITE_HOURS = 48;

const OWNER_SELECT =
  "id, emri, email, roli, aktiv, client_id, created_at, invite_token, invite_expires_at, password_set_at, passwordi, clients(id, emri, tipi)";

function generateInviteToken() {
  return crypto.randomBytes(32).toString("hex");
}

function inviteExpiresAt() {
  return new Date(Date.now() + INVITE_HOURS * 60 * 60 * 1000).toISOString();
}

function isOwnerActivated(user) {
  return Boolean(user?.passwordi && String(user.passwordi).trim());
}

function ownerAccountStatus(user) {
  return isOwnerActivated(user) ? "aktiv" : "pending";
}

function buildInviteUrl(token, baseUrl) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  return `${base}/owner/setup?token=${encodeURIComponent(token)}`;
}

function sanitizeOwnerForAdmin(user, baseUrl) {
  if (!user) return user;
  const status = ownerAccountStatus(user);
  const invite_url =
    status === "pending" && user.invite_token
      ? buildInviteUrl(user.invite_token, baseUrl)
      : null;
  const { passwordi, invite_token, ...safe } = user;
  return {
    ...safe,
    account_status: status,
    invite_url,
    invite_expires_at: user.invite_expires_at || null,
  };
}

async function listOwners(baseUrl) {
  const db = getSupabase();
  let { data, error } = await db
    .from("users")
    .select(OWNER_SELECT)
    .eq("roli", "client_admin")
    .order("created_at", { ascending: false });

  if (error?.code === "PGRST204" || (error?.message && /aktiv|invite_token/i.test(error.message))) {
    ({ data, error } = await db
      .from("users")
      .select("id, emri, email, roli, client_id, created_at, passwordi, clients(id, emri, tipi)")
      .eq("roli", "client_admin")
      .order("created_at", { ascending: false }));
    data = (data || []).map(u => ({ ...u, aktiv: true }));
  }

  if (error) throw error;
  return (data || []).map(u => sanitizeOwnerForAdmin(u, baseUrl));
}

async function createOwner({ client_id, emri, email, password }, baseUrl) {
  if (!client_id) throw new Error("Zgjidhni klientin (restorantin/kafenen).");
  if (!emri?.trim()) throw new Error("Emri i pronarit është i detyrueshëm.");
  if (!email?.trim()) throw new Error("Email është i detyrueshëm.");

  const db = getSupabase();
  const row = {
    client_id,
    emri: emri.trim(),
    email: email.trim().toLowerCase(),
    roli: "client_admin",
    aktiv: true,
  };

  const pw = password != null ? String(password).trim() : "";
  if (pw) {
    if (pw.length < 6) throw new Error("Fjalëkalimi min. 6 karaktere.");
    row.passwordi = await bcrypt.hash(pw, 12);
    row.password_set_at = new Date().toISOString();
    row.invite_token = null;
    row.invite_expires_at = null;
  } else {
    row.passwordi = null;
    row.invite_token = generateInviteToken();
    row.invite_expires_at = inviteExpiresAt();
    row.password_set_at = null;
  }

  let { data, error } = await db.from("users").insert(row).select(OWNER_SELECT).single();

  if (error?.code === "PGRST204" || (error?.message && /aktiv|invite_token/i.test(error.message))) {
    const fallbackRow = { ...row };
    delete fallbackRow.invite_token;
    delete fallbackRow.invite_expires_at;
    delete fallbackRow.password_set_at;
    if (!fallbackRow.passwordi) {
      throw new Error(
        "Baza e të dhënave nuk ka migrimin e ftesës së pronarit. Ekzekutoni supabase/migrations/006_owner_invite.sql.",
      );
    }
    ({ data, error } = await db.from("users").insert(fallbackRow).select(OWNER_SELECT).single());
  }

  if (error) {
    if (error.code === "23505") throw new Error("Ky email ekziston tashmë.");
    throw error;
  }

  const owner = sanitizeOwnerForAdmin(data, baseUrl);

  if (!pw && owner.invite_url && isEmailConfigured()) {
    try {
      const clientName = data.clients?.emri || "";
      await sendOwnerInviteEmail({
        to: owner.email,
        emri: owner.emri,
        clientName,
        inviteUrl: owner.invite_url,
      });
      owner.invite_email_sent = true;
    } catch (err) {
      console.error("[owner-invite] email failed:", err.message);
      owner.invite_email_sent = false;
    }
  }

  return owner;
}

async function regenerateOwnerInvite(id, baseUrl) {
  const db = getSupabase();
  const { data: existing, error: findErr } = await db
    .from("users")
    .select(OWNER_SELECT)
    .eq("id", id)
    .eq("roli", "client_admin")
    .maybeSingle();
  if (findErr) throw findErr;
  if (!existing) throw new Error("Pronari nuk u gjet.");
  if (isOwnerActivated(existing)) {
    throw new Error("Llogaria është aktivizuar — nuk gjenerohet ftesë e re.");
  }

  const patch = {
    invite_token: generateInviteToken(),
    invite_expires_at: inviteExpiresAt(),
  };

  const { data, error } = await db
    .from("users")
    .update(patch)
    .eq("id", id)
    .eq("roli", "client_admin")
    .select(OWNER_SELECT)
    .single();
  if (error) throw error;
  const owner = sanitizeOwnerForAdmin(data, baseUrl);

  if (isEmailConfigured()) {
    try {
      const clientName = data.clients?.emri || "";
      await sendOwnerInviteEmail({
        to: owner.email,
        emri: owner.emri,
        clientName,
        inviteUrl: owner.invite_url,
      });
      owner.invite_email_sent = true;
    } catch (err) {
      console.error("[owner-invite] email failed:", err.message);
      owner.invite_email_sent = false;
    }
  }

  return owner;
}

async function findOwnerByInviteToken(token) {
  const t = String(token || "").trim();
  if (!t) return null;
  const db = getSupabase();
  const { data, error } = await db
    .from("users")
    .select("id, emri, email, roli, client_id, invite_token, invite_expires_at, passwordi, clients(id, emri, tipi)")
    .eq("roli", "client_admin")
    .eq("invite_token", t)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getOwnerLoginBranding(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return { ok: false };

  const db = getSupabase();
  const { data, error } = await db
    .from("users")
    .select("emri, email, passwordi, clients(emri, tipi)")
    .eq("roli", "client_admin")
    .eq("email", e)
    .maybeSingle();

  if (error || !data) return { ok: false };

  const clientName = data.clients?.emri || "";
  const clientType = data.clients?.tipi || "";
  return {
    ok: true,
    owner_name: data.emri || "",
    client_name: clientName,
    client_type: clientType,
    pending_setup: !isOwnerActivated(data),
  };
}

async function validateOwnerInvite(token) {
  const user = await findOwnerByInviteToken(token);
  if (!user) {
    return { valid: false, code: "NOT_FOUND", message: "Linku i ftesës nuk është i vlefshëm." };
  }
  if (isOwnerActivated(user)) {
    return { valid: false, code: "ALREADY_ACTIVE", message: "Llogaria është aktivizuar. Hyni me email dhe fjalëkalim." };
  }
  if (!user.invite_expires_at || new Date(user.invite_expires_at) < new Date()) {
    return { valid: false, code: "EXPIRED", message: "Linku i ftesës ka skaduar. Kontaktoni administratorin." };
  }
  return {
    valid: true,
    emri: user.emri,
    email: user.email,
    client_name: user.clients?.emri || "",
  };
}

async function completeOwnerSetup(token, password) {
  const pw = String(password || "").trim();
  if (pw.length < 6) throw new Error("Fjalëkalimi min. 6 karaktere.");

  const check = await validateOwnerInvite(token);
  if (!check.valid) {
    const err = new Error(check.message);
    err.code = check.code;
    throw err;
  }

  const db = getSupabase();
  const hash = await bcrypt.hash(pw, 12);
  const { data, error } = await db
    .from("users")
    .update({
      passwordi: hash,
      password_set_at: new Date().toISOString(),
      invite_token: null,
      invite_expires_at: null,
    })
    .eq("invite_token", String(token).trim())
    .eq("roli", "client_admin")
    .select("id, emri, email, client_id")
    .single();

  if (error) throw error;
  if (!data) throw new Error("Ftesa nuk u gjet.");
  return data;
}

async function updateOwner(id, { emri, email, password, aktiv }, baseUrl) {
  const db = getSupabase();
  const patch = {};
  if (emri != null) {
    patch.emri = String(emri).trim();
    if (!patch.emri) throw new Error("Emri i pronarit është i detyrueshëm.");
  }
  if (email != null) {
    patch.email = String(email).trim().toLowerCase();
    if (!patch.email) throw new Error("Email është i detyrueshëm.");
  }
  if (password != null && String(password).trim()) {
    if (String(password).length < 6) throw new Error("Fjalëkalimi min. 6 karaktere.");
    patch.passwordi = await bcrypt.hash(String(password), 12);
    patch.password_set_at = new Date().toISOString();
    patch.invite_token = null;
    patch.invite_expires_at = null;
  }
  if (typeof aktiv === "boolean") patch.aktiv = aktiv;

  if (!Object.keys(patch).length) throw new Error("Nuk ka fusha për përditësim.");

  let { data, error } = await db
    .from("users")
    .update(patch)
    .eq("id", id)
    .eq("roli", "client_admin")
    .select(OWNER_SELECT)
    .single();

  if (error?.code === "PGRST204" || (error?.message && /aktiv|invite_token/i.test(error.message))) {
    const { aktiv: _a, invite_token: _it, invite_expires_at: _ie, password_set_at: _ps, ...patchWithout } = patch;
    if (!Object.keys(patchWithout).length && typeof aktiv !== "boolean") {
      throw new Error("Nuk ka fusha për përditësim.");
    }
    ({ data, error } = await db
      .from("users")
      .update(patchWithout)
      .eq("id", id)
      .eq("roli", "client_admin")
      .select(OWNER_SELECT)
      .single());
    if (data && typeof aktiv === "boolean") data.aktiv = aktiv;
  }

  if (error) {
    if (error.code === "23505") throw new Error("Ky email ekziston tashmë.");
    throw error;
  }
  if (!data) throw new Error("Pronari nuk u gjet.");
  return sanitizeOwnerForAdmin(data, baseUrl);
}

async function deleteOwner(id) {
  const db = getSupabase();
  const { error } = await db.from("users").delete().eq("id", id).eq("roli", "client_admin");
  if (error) throw error;
  return { ok: true };
}

async function setOwnerActive(id, aktiv) {
  const db = getSupabase();
  const { data, error } = await db
    .from("users")
    .update({ aktiv: !!aktiv })
    .eq("id", id)
    .eq("roli", "client_admin")
    .select("id, emri, email, aktiv, client_id")
    .single();
  if (error) throw error;
  if (!data) throw new Error("Pronari nuk u gjet.");
  return data;
}

async function adminResetOwnerPassword(id, baseUrl) {
  const db = getSupabase();
  const { data: owner, error } = await db
    .from("users")
    .select(OWNER_SELECT)
    .eq("id", id)
    .eq("roli", "client_admin")
    .maybeSingle();
  if (error) throw error;
  if (!owner) throw new Error("Pronari nuk u gjet.");

  if (!isOwnerActivated(owner)) {
    return regenerateOwnerInvite(id, baseUrl);
  }

  const { requestOwnerPasswordReset } = require("./ownerPasswordReset");
  await requestOwnerPasswordReset(owner.email);
  return sanitizeOwnerForAdmin(owner, baseUrl);
}

/** Pronarët e lidhur me një klient (për Master Admin). */
async function listOwnersForClient(clientId, baseUrl) {
  const db = getSupabase();
  const id = String(clientId || "").trim();
  if (!id) return [];
  const { data, error } = await db
    .from("users")
    .select(OWNER_SELECT)
    .eq("client_id", id)
    .eq("roli", "client_admin")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map((u) => sanitizeOwnerForAdmin(u, baseUrl));
}

/**
 * Master Admin: vendos fjalëkalim të ri për pronarin e klientit.
 * Nëse nuk ka pronar, krijon një me email-in e klientit.
 */
async function setOwnerPasswordForClient(clientId, password, { email, emri, baseUrl } = {}) {
  const pw = String(password || "").trim();
  if (pw.length < 6) throw new Error("Fjalëkalimi min. 6 karaktere.");
  const owners = await listOwnersForClient(clientId, baseUrl);
  if (owners.length) {
    const updated = [];
    for (const o of owners) {
      updated.push(await updateOwner(o.id, { password: pw }, baseUrl));
    }
    return { owners: updated, created: false };
  }
  const mail = String(email || "").trim().toLowerCase();
  if (!mail) {
    throw new Error("Vendos email të klientit para se të vendosësh fjalëkalimin.");
  }
  const owner = await ensureOwnerForClient(
    {
      client_id: clientId,
      email: mail,
      emri: emri || "Pronar",
      password: pw,
    },
    baseUrl,
  );
  return { owners: [owner], created: true };
}

/** Master Admin: dërgo kod rivendosjeje me email te të gjithë pronarët e klientit. */
async function sendPasswordResetForClient(clientId, baseUrl) {
  const owners = await listOwnersForClient(clientId, baseUrl);
  if (!owners.length) {
    throw new Error("Nuk ka llogari pronari për këtë klient. Vendos email + fjalëkalim së pari.");
  }
  const { requestOwnerPasswordReset } = require("./ownerPasswordReset");
  const sent = [];
  for (const o of owners) {
    if (!o.email) continue;
    if (o.account_status === "pending") {
      await regenerateOwnerInvite(o.id, baseUrl);
      sent.push({ email: o.email, type: "invite" });
    } else {
      await requestOwnerPasswordReset(o.email);
      sent.push({ email: o.email, type: "reset_code" });
    }
  }
  if (!sent.length) throw new Error("Nuk u gjet email i vlefshëm për rivendosje.");
  return { ok: true, sent };
}

async function ensureOwnerForClient({ client_id, emri, email, password }, baseUrl) {
  if (!client_id) throw new Error("Mungon client_id.");
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) throw new Error("Email i pronarit mungon.");

  const db = getSupabase();
  const { data: client, error: cErr } = await db
    .from("clients")
    .select("id, emri")
    .eq("id", client_id)
    .maybeSingle();
  if (cErr) throw cErr;
  if (!client) throw new Error("Klienti nuk u gjet.");

  const { data: existing, error: uErr } = await db
    .from("users")
    .select("id, emri, email, client_id")
    .eq("email", normalizedEmail)
    .eq("roli", "client_admin")
    .maybeSingle();
  if (uErr) throw uErr;

  if (existing) {
    if (existing.client_id === client_id) {
      const { data } = await db.from("users").select(OWNER_SELECT).eq("id", existing.id).single();
      return sanitizeOwnerForAdmin(data, baseUrl);
    }
    const { linkClientToOwnerUser } = require("./ownerGroupService");
    await linkClientToOwnerUser(client_id, existing.id);
    const { data } = await db.from("users").select(OWNER_SELECT).eq("id", existing.id).single();
    return sanitizeOwnerForAdmin(data, baseUrl);
  }

  const pw = password != null ? String(password).trim() : "";
  if (!pw || pw.length < 6) {
    throw new Error("Për email të ri vendosni fjalëkalim min. 6 karaktere.");
  }

  return createOwner(
    {
      client_id,
      emri: String(emri || client.emri || "Pronar").trim(),
      email: normalizedEmail,
      password: pw,
    },
    baseUrl,
  );
}

module.exports = {
  listOwners,
  listOwnersForClient,
  createOwner,
  ensureOwnerForClient,
  regenerateOwnerInvite,
  findOwnerByInviteToken,
  getOwnerLoginBranding,
  validateOwnerInvite,
  completeOwnerSetup,
  updateOwner,
  deleteOwner,
  setOwnerActive,
  ownerAccountStatus,
  buildInviteUrl,
  adminResetOwnerPassword,
  setOwnerPasswordForClient,
  sendPasswordResetForClient,
};
