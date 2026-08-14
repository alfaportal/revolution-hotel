const express = require("express");
const cors = require("cors");

function corsOrigin(origin, callback) {
  if (!origin) return callback(null, true);

  const explicit = (process.env.CORS_ORIGIN || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  if (explicit.includes(origin)) return callback(null, true);

  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return callback(null, true);
  }
  if (/^https:\/\/[\w-]+\.up\.railway\.app$/.test(origin)) {
    return callback(null, true);
  }
  if (/^https:\/\/(www\.)?revolution-pos\.com$/.test(origin)) {
    return callback(null, true);
  }

  if (process.env.NODE_ENV !== "production") return callback(null, true);

  console.warn("[cors] Origjina e refuzuar:", origin);
  callback(null, true);
}

function requestLogger(req, res, next) {
  const start = Date.now();
  res.on("finish", () => {
    console.log(
      `[http] ${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - start}ms)`,
    );
  });
  next();
}

function jsonErrorHandler(err, req, res, next) {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    console.warn("[http] JSON i pavlefshëm:", req.method, req.originalUrl);
    return res.status(400).json({ gabim: "JSON i pavlefshëm në trupin e kërkesës." });
  }
  next(err);
}

function noCachePanel(req, res, next) {
  if (/\.(html|js)$/.test(req.path) && !req.path.startsWith("/api")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  }
  next();
}

module.exports = {
  corsMiddleware: cors({ origin: corsOrigin, credentials: true }),
  requestLogger,
  jsonErrorHandler,
  noCachePanel,
};
