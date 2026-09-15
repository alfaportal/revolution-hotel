/** Rruga sekrete e panelit Super Admin — mos përdor /panel publik. */
function adminPanelPath() {
  const raw = (process.env.ADMIN_PANEL_PATH || "ri-super").trim().replace(/\/+$/, "");
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  if (path === "/" || path.startsWith("/owner") || path.startsWith("/api")) {
    throw new Error("ADMIN_PANEL_PATH i pavlefshëm (mos përdor /, /owner/*, /api/*)");
  }
  return path;
}

module.exports = { adminPanelPath };
