"use strict";
/** SYNC RESET (Step 2) — cloud relay stub deri Step 3. */

const errUnavailable = () => {
  const e = new Error("Relay çaktivizuar (sync reset)");
  e.code = "RELAY_UNAVAILABLE";
  throw e;
};

module.exports = {
  seal: (x) => x,
  open: (x) => x,
  hashOf: () => "",
  toLocalIso: (ts) => ts,
  absorbPrimaryLastSeen: () => null,
  getMasterPrimaryLastSeenAt: () => null,
  isMasterPrimaryOnlineOnCloud: () => false,
  PRIMARY_CLOUD_ONLINE_MS: 120000,
  pushQueueItems: errUnavailable,
  pushPresence: errUnavailable,
  fetchRelayPresence: errUnavailable,
  pullQueue: errUnavailable,
  ackQueueItems: errUnavailable,
  publishSnapshots: errUnavailable,
  fetchSnapshots: errUnavailable,
  fetchSnapshotKind: errUnavailable,
  createLanLocator: () => ({ locate: async () => null, status: () => ({}) }),
  LAN_PROBE_TIMEOUT_MS: 2500,
  LAN_OK_TTL_MS: 60000,
  LAN_RETRY_MS: 5000,
};
