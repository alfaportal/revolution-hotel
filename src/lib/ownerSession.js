const { signToken } = require("../middleware/auth");

const OWNER_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: 12 * 60 * 60 * 1000,
};

function issueOwnerSession(res, payload) {
  const token = signToken(payload);
  res.cookie("owner_token", token, OWNER_COOKIE_OPTS);
  return token;
}

module.exports = { issueOwnerSession, OWNER_COOKIE_OPTS };
