const express = require("express");
const { signToken, authRequired, authOwner } = require("../middleware/auth");
const {
  findUserByEmail,
  verifyUserPassword,
} = require("../services/licenseService");
const {
  validateOwnerInvite,
  completeOwnerSetup,
  getOwnerLoginBranding,
} = require("../services/userService");
const {
  isOwnerRegistrationEnabled,
  registerOwnerWithCode,
} = require("../services/ownerRegistrationService");
const {
  clearFailCount,
  handleOwnerWrongPassword,
  requestOwnerPasswordReset,
  completeOwnerPasswordReset,
  changeOwnerPassword,
  MIN_PASSWORD,
} = require("../services/ownerPasswordReset");
const { buildOwnerAuthContext } = require("../services/ownerGroupService");
const { issueOwnerSession } = require("../lib/ownerSession");

const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ gabim: "Email dhe fjalëkalimi janë të detyrueshëm." });
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ gabim: "Kredencialet janë të gabuara." });
    }

    if (user.roli === "client_admin") {
      return res.status(403).json({
        gabim: "Ky email është i pronarit (restorant/kafene). Hyni te /owner/login — jo këtu.",
        code: "WRONG_PORTAL",
      });
    }

    const ok = await verifyUserPassword(user, password);
    if (!ok) {
      return res.status(401).json({ gabim: "Kredencialet janë të gabuara." });
    }

    if (user.roli === "client_admin") {
      return res.status(403).json({
        gabim: "Këto kredenciale nuk kanë akses në këtë hyrje.",
      });
    }
    if (user.roli !== "super_admin") {
      return res.status(401).json({ gabim: "Kredencialet janë të gabuara." });
    }

    const token = signToken({
      sub: user.id,
      email: user.email,
      emri: user.emri,
      roli: user.roli,
      client_id: user.client_id,
    });

    res.cookie("rip_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 12 * 60 * 60 * 1000,
    });

    try {
      const { logAdminActivity } = require("../services/activityLogService");
      await logAdminActivity({
        actorUserId: user.id,
        actorEmail: user.email,
        action: "admin_login",
        targetType: "user",
        targetId: user.id,
        targetLabel: user.email,
      });
    } catch {
      /* optional */
    }

    res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        emri: user.emri,
        email: user.email,
        roli: user.roli,
      },
    });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

router.post("/owner/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "").trim();
    if (!email || !password) {
      return res.status(400).json({ gabim: "Email dhe fjalëkalimi janë të detyrueshëm." });
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ gabim: "Kredencialet janë të gabuara." });
    }

    if (!user.passwordi) {
      return res.status(403).json({
        gabim: "Llogaria nuk është aktivizuar. Përdorni linkun e ftesës për të vendosur fjalëkalimin.",
        code: "PENDING_SETUP",
      });
    }

    const ok = await verifyUserPassword(user, password);
    if (!ok) {
      const body = await handleOwnerWrongPassword(user, email);
      return res.status(401).json(body);
    }

    if (user.roli === "super_admin") {
      return res.status(403).json({
        gabim: "Ky email është i Super Admin-it. Pronarët hyjnë këtu; Master Admin hyn te /admin.",
        code: "WRONG_PORTAL",
      });
    }
    if (user.roli !== "client_admin") {
      return res.status(401).json({ gabim: "Kredencialet janë të gabuara." });
    }
    if (user.aktiv === false) {
      return res.status(403).json({ gabim: "Llogaria është çaktivizuar. Kontaktoni supportin." });
    }
    if (!user.client_id) {
      return res.status(403).json({ gabim: "Llogaria nuk është e lidhur me restorant." });
    }

    clearFailCount(email);

    const authPayload = await buildOwnerAuthContext(user, { clientId: user.client_id });
    const token = issueOwnerSession(res, authPayload);

    res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        emri: user.emri,
        email: user.email,
        roli: user.roli,
        client_id: authPayload.client_id,
        owner_group_id: authPayload.owner_group_id,
        view_all: authPayload.view_all,
      },
    });
  } catch (e) {
    res.status(500).json({ gabim: e.message });
  }
});

router.post("/logout", (_req, res) => {
  res.clearCookie("rip_token");
  res.json({ ok: true });
});

router.get("/owner/branding", async (req, res) => {
  try {
    const branding = await getOwnerLoginBranding(req.query.email);
    if (!branding.ok) {
      return res.json({ ok: false });
    }
    res.json({ ok: true, ...branding });
  } catch (e) {
    res.status(500).json({ ok: false, gabim: e.message });
  }
});

router.get("/owner/invite/:token", async (req, res) => {
  try {
    const result = await validateOwnerInvite(req.params.token);
    const status = result.valid ? 200 : 400;
    res.status(status).json(result);
  } catch (e) {
    res.status(500).json({ valid: false, gabim: e.message });
  }
});

router.post("/owner/setup", async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ ok: false, gabim: "Token dhe fjalëkalimi janë të detyrueshëm." });
    }
    const user = await completeOwnerSetup(token, password);
    res.json({
      ok: true,
      message: "Llogaria u aktivizua. Tani mund të hyni.",
      email: user.email,
    });
  } catch (e) {
    const status = e.code === "NOT_FOUND" || e.code === "EXPIRED" || e.code === "ALREADY_ACTIVE" ? 400 : 500;
    res.status(status).json({ ok: false, gabim: e.message, code: e.code || null });
  }
});

router.get("/owner/register-config", (_req, res) => {
  res.json({ ok: true, registration_enabled: isOwnerRegistrationEnabled() });
});

router.post("/owner/register", async (req, res) => {
  try {
    const { getPublicAppOrigin } = require("../lib/publicOrigin");
    const baseUrl = getPublicAppOrigin();
    const { client, license, owner } = await registerOwnerWithCode(req.body, baseUrl);

    const user = await findUserByEmail(owner.email);
    if (!user?.passwordi) {
      return res.status(500).json({ gabim: "Llogaria u krijua por hyrja dështoi. Provoni /owner/login." });
    }

    const authPayload = await buildOwnerAuthContext(user, { clientId: user.client_id });
    const token = issueOwnerSession(res, authPayload);

    res.status(201).json({
      ok: true,
      message: "Llogaria u krijua. Je i kyçur në panel.",
      token,
      license_key: license?.celesi || null,
      user: {
        id: user.id,
        emri: user.emri,
        email: user.email,
        roli: user.roli,
        client_id: authPayload.client_id,
        client_name: client?.emri || "",
        owner_group_id: authPayload.owner_group_id,
        view_all: authPayload.view_all,
      },
    });
  } catch (e) {
    const status =
      e.code === "INVALID_CODE" || e.code === "REGISTRATION_DISABLED" ? 403 : 400;
    res.status(status).json({ gabim: e.message, code: e.code || null });
  }
});

router.post("/owner/logout", (_req, res) => {
  res.clearCookie("owner_token");
  res.json({ ok: true });
});

router.post("/owner/password/forgot", async (req, res) => {
  try {
    const email = req.body?.email;
    const result = await requestOwnerPasswordReset(email);
    res.json(result);
  } catch (e) {
    if (e.message === "EMAIL_NOT_CONFIGURED") {
      return res.status(503).json({
        gabim: "Emaili nuk është i konfiguruar. Vendosni RESEND_API_KEY në Railway.",
        code: "EMAIL_NOT_CONFIGURED",
      });
    }
    res.status(500).json({ gabim: e.message });
  }
});

router.post("/owner/password/reset", async (req, res) => {
  try {
    const { email, code, new_password: newPassword } = req.body || {};
    const user = await completeOwnerPasswordReset(email, code, newPassword);

    const token = signToken({
      sub: user.id,
      email: user.email,
      emri: user.emri,
      roli: user.roli,
      client_id: user.client_id,
    });

    res.cookie("owner_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 12 * 60 * 60 * 1000,
    });

    res.json({
      ok: true,
      message: "Fjalëkalimi u ndryshua. Je i kyçur.",
      token,
      user: {
        id: user.id,
        emri: user.emri,
        email: user.email,
        roli: user.roli,
        client_id: user.client_id,
      },
    });
  } catch (e) {
    const status =
      e.code === "INVALID_CODE" || e.code === "CODE_EXPIRED" ? 400 : 500;
    res.status(status).json({
      gabim: e.message,
      code: e.code || null,
    });
  }
});

/** Ndrysho fjalëkalimin (telefon + panel) — i njëjti password për të dyja. */
router.post("/owner/password/change", authOwner, async (req, res) => {
  try {
    const current =
      req.body?.current_password ?? req.body?.old_password ?? req.body?.password;
    const next = req.body?.new_password ?? req.body?.password_new;
    const confirm = req.body?.new_password2 ?? req.body?.confirm_password;
    if (confirm != null && String(confirm) !== String(next || "")) {
      return res.status(400).json({
        gabim: "Fjalëkalimet e reja nuk përputhen.",
        code: "MISMATCH",
      });
    }
    const userId = req.user?.sub || req.user?.id;
    const user = await changeOwnerPassword(userId, current, next);
    res.json({
      ok: true,
      message: "Fjalëkalimi u ndryshua. Përdoreni të njëjtin edhe në telefon dhe në panel.",
      user: {
        id: user.id,
        emri: user.emri,
        email: user.email,
        roli: user.roli,
        client_id: user.client_id,
      },
      min_password: MIN_PASSWORD,
    });
  } catch (e) {
    const status =
      e.code === "INVALID_CURRENT" ||
      e.code === "WEAK_PASSWORD" ||
      e.code === "SAME_PASSWORD" ||
      e.code === "CURRENT_REQUIRED" ||
      e.code === "NOT_FOUND"
        ? 400
        : e.code === "UNAUTHORIZED"
          ? 401
          : 500;
    res.status(status).json({ gabim: e.message, code: e.code || null });
  }
});

router.get("/me", authRequired, (req, res) => {
  if (req.user?.roli !== "super_admin") {
    return res.status(403).json({ gabim: "Akses i ndaluar." });
  }
  res.json({ ok: true, user: req.user });
});

router.get("/owner/me", authOwner, (req, res) => {
  res.json({ ok: true, user: req.user });
});

module.exports = router;
