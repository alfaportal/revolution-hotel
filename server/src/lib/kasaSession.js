const crypto = require("crypto");

function sessionSecret() {
  return String(
    process.env.KASA_SESSION_SECRET ||
      process.env.MASTER_EMERGENCY_PIN ||
      "revolution-kasa-session-v1",
  );
}

/** Token i shkurtër (90s) — kasa desktop → kamarier pa PIN të dyfishtë. */
function createKasaSessionToken(clientId, waiterId) {
  const exp = Date.now() + 90_000;
  const cid = String(clientId || "").trim();
  const wid = String(waiterId || "").trim();
  const payload = `${cid}|${wid}|${exp}`;
  const sig = crypto.createHmac("sha256", sessionSecret()).update(payload).digest("hex").slice(0, 20);
  return Buffer.from(`${payload}|${sig}`).toString("base64url");
}

function verifyKasaSessionToken(token, clientId) {
  try {
    const raw = Buffer.from(String(token || ""), "base64url").toString("utf8");
    const parts = raw.split("|");
    if (parts.length !== 4) return null;
    const [cid, wid, expStr, sig] = parts;
    if (cid !== String(clientId || "").trim()) return null;
    const exp = Number(expStr);
    if (!exp || Date.now() > exp) return null;
    const payload = `${cid}|${wid}|${expStr}`;
    const expect = crypto.createHmac("sha256", sessionSecret()).update(payload).digest("hex").slice(0, 20);
    if (sig !== expect) return null;
    return { waiterId: wid };
  } catch {
    return null;
  }
}

module.exports = {
  createKasaSessionToken,
  verifyKasaSessionToken,
};
