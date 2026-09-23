/**
 * portable-path.js — të dhënat fiskale / z-reports (parity BIZNES, HOTEL userData).
 */
const path = require("path");
const os = require("os");

function getDataDir() {
  if (process.env.HOTEL_DATA_DIR) {
    return path.resolve(process.env.HOTEL_DATA_DIR);
  }
  if (process.env.BIZNES_DATA_DIR) {
    return path.resolve(process.env.BIZNES_DATA_DIR);
  }
  if (process.env.DB_PATH) {
    return path.dirname(path.resolve(process.env.DB_PATH));
  }
  return path.join(os.homedir(), "AppData", "Roaming", "Revolution HOTEL");
}

module.exports = {
  getDataDir,
};
