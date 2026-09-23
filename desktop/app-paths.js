"use strict";

const path = require("path");

/** Rrënjë e përmbajtjes së app (public/, build/) — edhe kur entry është në app.asar.unpacked. */
function getAppContentRoot() {
  try {
    const { app } = require("electron");
    if (app?.isPackaged && typeof app.getAppPath === "function") {
      return app.getAppPath();
    }
  } catch {
    /* jo në Electron */
  }
  return __dirname;
}

function joinContent(...segments) {
  return path.join(getAppContentRoot(), ...segments);
}

module.exports = {
  getAppContentRoot,
  joinContent,
};
