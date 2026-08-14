const jwt = require("jsonwebtoken");
const { trimEnv } = require("../lib/env");

function jwtSecret() {
  const secret = trimEnv("JWT_SECRET");
  if (!secret || secret.length < 16) {
    throw new Error("JWT_SECRET duhet të jetë të paktën 16 karaktere");
  }
  return secret;
}

function signToken(payload) {
  return jwt.sign(payload, jwtSecret(), {
    expiresIn: process.env.JWT_EXPIRES_IN || "12h",
  });
}

/** Leeway për clock drift midis kontejnerëve Railway (iat / nbf / exp). */
const JWT_CLOCK_TOLERANCE_SEC = Math.max(
  0,
  Number(process.env.JWT_CLOCK_TOLERANCE_SEC || 60) || 60,
);

function jwtVerifyOptions() {
  return {
    clockTolerance: JWT_CLOCK_TOLERANCE_SEC,
    ignoreNotBefore: true,
  };
}

function verifyToken(token) {
  try {
    return jwt.verify(token, jwtSecret(), jwtVerifyOptions());
  } catch (err) {
    // "jwt issued at future" / Token used before issued — ora e kontejnerit prapa
    const msg = String(err?.message || err || "");
    if (/future|before issued|not active|nbf/i.test(msg)) {
      return jwt.verify(token, jwtSecret(), {
        ...jwtVerifyOptions(),
        // Trajto "tani" si +leeway që iat pak në të ardhmen të pranohet
        clockTimestamp: Math.floor(Date.now() / 1000) + JWT_CLOCK_TOLERANCE_SEC,
      });
    }
    throw err;
  }
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const cookie = req.cookies?.rip_token;
  const token = header.startsWith("Bearer ") ? header.slice(7) : cookie;

  if (!token) {
    return res.status(401).json({ gabim: "Kërkohet autentifikim." });
  }

  try {
    req.user = verifyToken(token);
    if (req.user.roli === "client_admin") {
      return res.status(403).json({ gabim: "Këto kredenciale nuk kanë akses në këtë hyrje." });
    }
    next();
  } catch {
    return res.status(401).json({ gabim: "Sesioni skadoi. Hyni përsëri." });
  }
}

function superAdminOnly(req, res, next) {
  if (req.user?.roli !== "super_admin") {
    return res.status(403).json({ gabim: "Vetëm Super Admin." });
  }
  next();
}

function licenseApiKeyOptional(req, res, next) {
  const required = process.env.LICENSE_API_KEY;
  if (!required) return next();
  const key = req.headers["x-api-key"];
  if (key !== required) {
    return res.status(401).json({ gabim: "API key i pavlefshëm." });
  }
  next();
}

function ownerOnly(req, res, next) {
  if (req.user?.roli === "super_admin") {
    return res.status(403).json({ gabim: "Këto kredenciale nuk kanë akses në këtë hyrje." });
  }
  if (req.user?.roli !== "client_admin") {
    return res.status(403).json({ gabim: "Vetëm pronarët kanë akses." });
  }
  if (!req.user?.client_id) {
    return res.status(403).json({ gabim: "Llogaria nuk është e lidhur me restorant." });
  }
  next();
}

function authOwner(req, res, next) {
  const header = req.headers.authorization || "";
  const cookie = req.cookies?.owner_token;
  const queryToken = typeof req.query?.token === "string" ? req.query.token.trim() : "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : (cookie || queryToken);

  if (!token) {
    return res.status(401).json({ gabim: "Kërkohet autentifikim." });
  }

  try {
    req.user = verifyToken(token);
    if (req.user.roli === "super_admin") {
      return res.status(403).json({ gabim: "Këto kredenciale nuk kanë akses në këtë hyrje." });
    }
    if (req.user.roli !== "client_admin") {
      return res.status(403).json({ gabim: "Akses i ndaluar." });
    }
    next();
  } catch {
    return res.status(401).json({ gabim: "Sesioni skadoi. Hyni përsëri." });
  }
}

module.exports = {
  signToken,
  verifyToken,
  authRequired,
  authOwner,
  superAdminOnly,
  ownerOnly,
  licenseApiKeyOptional,
};
