"use strict";
/** SYNC RESET (Step 2) — LAN multi-arka stub deri Step 3. */

function createTerminalLanSync() {
  return {
    syncStaffFromMaster: async () => {},
    syncMenuFromMaster: async () => {},
    syncStockFromMaster: async () => {},
    syncServicesFromMaster: async () => {},
    syncAllFromMaster: async () => {},
    syncCatalogFromCloudSnapshots: async () => {},
    flushLanOutboxToMaster: async () => {},
    startTerminalLanSync: () => {},
    pingMasterRegister: async () => false,
    masterLanLocator: { locate: async () => null, status: () => ({}), markOk: () => {}, markFailed: () => {} },
    getCloudRelayLinkStatus: () => ({}),
  };
}

module.exports = {
  createTerminalLanSync,
  createMasterLanLocator: () => ({ locate: async () => null, status: () => ({}) }),
  LAN_SYNC_INTERVAL_MS: 45000,
  LAN_OUTBOX_INTERVAL_MS: 15000,
};
