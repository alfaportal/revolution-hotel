/**
 * Arka 2+ — pull stafi, menusë, stokut dhe shërbimeve nga Kryesorja përmes LAN (.terminal-lan.json + multi-IP locator).
 */
const license = require("./license");
const cloudHealth = require("./cloud-health");
const terminalRelay = require("./terminal-relay");

const LAN_SYNC_INTERVAL_MS = 30 * 1000;
const LAN_OUTBOX_INTERVAL_MS = 10 * 1000;
const LAN_GET_TIMEOUT_MS = 15000;
const CLOUD_SNAPSHOT_MIN_MS = 15 * 1000;
const CLOUD_PRESENCE_HEARTBEAT_MS = 30 * 1000;

function createMasterLanLocator(deps) {
  const { electronApp, storedLicenseKeyForCloud } = deps;
  return terminalRelay.createLanLocator({
    readSaved: () => license.readTerminalLan(electronApp()),
    writeSaved: (host, port) => {
      license.writeTerminalLan(electronApp(), host, port);
      console.log(`[lan] Kryesorja u gjet te ${host}:${port} — adresa u ruajt`);
    },
    readRecentHosts: () => license.readTerminalLanRecentHosts(electronApp()),
    pushRecentHost: (host, port) => license.pushTerminalLanRecentHost(electronApp(), host, port),
    getCelesi: () => storedLicenseKeyForCloud(),
  });
}

async function getMasterJsonAtBase(base, celesi, apiPath, timeoutMs) {
  if (!base || !celesi) return null;
  try {
    const sep = apiPath.includes("?") ? "&" : "?";
    const pathWithKey = `${apiPath}${sep}celesi=${encodeURIComponent(celesi)}`;
    const r = await cloudHealth.requestJsonOnce("GET", base, pathWithKey, null, timeoutMs, {
      "x-license-key": celesi,
    });
    let parsed = {};
    try {
      parsed = JSON.parse(r.data || "{}");
    } catch {
      parsed = {};
    }
    if (r.status !== 200 || parsed.ok === false) return null;
    return { base, parsed };
  } catch (e) {
    console.warn(`[lan-sync] ${base}${apiPath}: ${e.message || e}`);
    return null;
  }
}

function buildRegisterPresence(db, registerNumber) {
  const outbox =
    typeof db.getLanOutboxStatus === "function"
      ? db.getLanOutboxStatus()
      : { pending: 0, last_error: null, last_sent_at: null };
  const ver = typeof db.getVersionInfo === "function" ? db.getVersionInfo() : {};
  return {
    register_number: registerNumber,
    app_version: String(ver.app_version || ver.version || "").slice(0, 40),
    pending: outbox.pending,
    last_error: outbox.last_error,
    last_sent_at: outbox.last_sent_at,
  };
}

/** Arka 2+ — kohët e fundit të pull-it nga Kryesorja (LAN ose cloud). */
function createLanPullStatus() {
  return {
    staff_at: null,
    menu_at: null,
    stock_at: null,
    services_at: null,
    stock_skipped_pending: 0,
    via: null,
  };
}

function settleLanOutbox(batch, acceptedRefs, rejectedList, db) {
  const accepted = new Set((acceptedRefs || []).map(Number));
  const sentIds = [];
  for (const row of batch) {
    if (accepted.has(Number(row.ref))) sentIds.push(row.id);
  }
  if (sentIds.length) db.markLanOutboxSent(sentIds);
  const rejectedByRef = new Map((rejectedList || []).map((x) => [Number(x.ref), x.gabim]));
  for (const row of batch) {
    if (!accepted.has(Number(row.ref))) {
      db.markLanOutboxFailed([row.id], rejectedByRef.get(Number(row.ref)) || "pa përgjigje");
    }
  }
  return sentIds.length;
}

function createTerminalLanSync(deps) {
  const { db, electronApp, storedLicenseKeyForCloud, terminalRegisterNumber } = deps;
  const masterLanLocator = createMasterLanLocator(deps);
  let busy = false;
  let outboxBusy = false;
  let cloudSnapshotAt = 0;
  let lastCloudPresenceAt = 0;
  const cloudSnapshotHave = {};
  const lanPullStatus = createLanPullStatus();

  function registerReportStatus(registerNumber, via) {
    return {
      ...buildRegisterPresence(db, registerNumber),
      register_number: registerNumber,
      via: via === "cloud" ? "cloud" : "lan",
      pull: { ...lanPullStatus },
    };
  }

  function markStockSkippedPending() {
    const pending = pendingLanSalesCount();
    lanPullStatus.stock_skipped_pending = Math.max(1, pending);
  }

  async function getMasterJson(celesi, apiPath, timeoutMs) {
    const base = await masterLanLocator.locate();
    return getMasterJsonAtBase(base, celesi, apiPath, timeoutMs);
  }

  async function pingMasterRegister(celesi) {
    const base = await masterLanLocator.locate();
    return !!base;
  }

  async function syncStaffFromMaster() {
    const celesi = storedLicenseKeyForCloud();
    if (!celesi) return;
    const res = await getMasterJson(celesi, "/api/terminal/staff", 8000);
    if (!res || !Array.isArray(res.parsed.staff)) return;
    const result = db.replaceStaffFromMaster(res.parsed.staff);
    if (result.ok && (result.added || result.updated || result.deactivated)) {
      console.log(
        `[lan-sync] staff nga ${res.base}: +${result.added} ~${result.updated} -${result.deactivated}`,
      );
    }
    if (result.ok) {
      lanPullStatus.staff_at = new Date().toISOString();
      lanPullStatus.via = "lan";
    }
    masterLanLocator.markOk();
  }

  async function syncMenuFromMaster() {
    const celesi = storedLicenseKeyForCloud();
    if (!celesi) return;
    const res = await getMasterJson(celesi, "/api/terminal/menu", LAN_GET_TIMEOUT_MS);
    if (!res || !Array.isArray(res.parsed.categories) || !Array.isArray(res.parsed.items)) return;
    const result = db.replaceMenuFromMaster({
      categories: res.parsed.categories,
      items: res.parsed.items,
    });
    if (!result.ok) return;
    const c = result.categories;
    const m = result.items;
    console.log(
      `[lan-sync] menu nga ${res.base}: kat +${c.added} ~${c.updated}, art +${m.added} ~${m.updated}`,
    );
    lanPullStatus.menu_at = new Date().toISOString();
    lanPullStatus.via = "lan";
    masterLanLocator.markOk();
  }

  async function syncServicesFromMaster() {
    const celesi = storedLicenseKeyForCloud();
    if (!celesi) return;
    const res = await getMasterJson(celesi, "/api/terminal/services", LAN_GET_TIMEOUT_MS);
    if (!res) return;
    const result = db.replaceServicesFromMaster({
      categories: res.parsed.categories,
      services: res.parsed.services,
    });
    if (!result.ok) return;
    const s = result.services;
    console.log(
      `[lan-sync] shërbime nga ${res.base}: +${s.added} ~${s.updated} -${s.deactivated}`,
    );
    lanPullStatus.services_at = new Date().toISOString();
    lanPullStatus.via = "lan";
    masterLanLocator.markOk();
  }

  function pendingLanSalesCount() {
    return typeof db.countPendingLanSales === "function" ? db.countPendingLanSales() : 0;
  }

  function ownDeviceId() {
    return String(license.getMachineId() || "").trim().toUpperCase();
  }

  function shouldSkipStockSync(ackedThroughFromMaster, { via = "cloud" } = {}) {
    const dev = ownDeviceId();
    if (pendingLanSalesCount() > 0) {
      console.log(`[stok-guard] ${pendingLanSalesCount()} shitje pending, skip sync stok`);
      return true;
    }
    const pendingRelay =
      typeof db.countPendingRelaySales === "function" ? db.countPendingRelaySales(dev) : 0;
    const relayBlocked =
      typeof db.relayStockGuardBlocks === "function" &&
      db.relayStockGuardBlocks(dev, ackedThroughFromMaster);
    if (pendingRelay > 0 || relayBlocked) {
      const where = via === "lan" ? "LAN" : "cloud";
      console.log(`[stok-guard-relay] shitje relay pa ack, skip sync stok ${where}`);
      return true;
    }
    return false;
  }

  async function syncStockFromMaster() {
    const celesi = storedLicenseKeyForCloud();
    if (!celesi) return;
    const pending = pendingLanSalesCount();
    if (pending > 0) {
      lanPullStatus.stock_skipped_pending = pending;
      return;
    }
    const res = await getMasterJson(celesi, "/api/terminal/stock", 8000);
    if (!res || !Array.isArray(res.parsed.items)) return;
    if (shouldSkipStockSync(res.parsed.relay_acked_through, { via: "lan" })) {
      markStockSkippedPending();
      return;
    }
    if (pendingLanSalesCount() > 0) {
      markStockSkippedPending();
      return;
    }
    const result = db.replaceStockFromMaster(res.parsed.items);
    if (result.ok && result.updated) {
      console.log(`[lan-sync] stok nga ${res.base}: ${result.updated} rreshta`);
    }
    if (result.ok) {
      lanPullStatus.stock_at = new Date().toISOString();
      lanPullStatus.stock_skipped_pending = 0;
      lanPullStatus.via = "lan";
    }
    masterLanLocator.markOk();
  }

  async function sendOutboxOverLan(base, celesi, num, deviceId, saleBatch, shiftBatch) {
    const r = await cloudHealth.requestJsonOnce(
      "POST",
      base,
      `/api/terminal/report?celesi=${encodeURIComponent(celesi)}`,
      {
        device_id: deviceId,
        register_number: num,
        sales: saleBatch.map((x) => x.payload),
        shifts: shiftBatch.map((x) => x.payload),
        status: registerReportStatus(num, "lan"),
      },
      15000,
      { "x-license-key": celesi },
    );
    let parsed = {};
    try {
      parsed = JSON.parse(r.data || "{}");
    } catch {
      parsed = {};
    }
    if (r.status !== 200 || parsed.ok === false) {
      throw new Error(`HTTP ${r.status} ${parsed.gabim || ""}`.trim());
    }
    const nSales = settleLanOutbox(saleBatch, parsed.accepted, parsed.rejected, db);
    const nShifts = settleLanOutbox(shiftBatch, parsed.accepted_shifts, parsed.rejected_shifts, db);
    if (nSales || nShifts) {
      console.log(`[lan-outbox] → Kryesore ${base}: ${nSales} shitje, ${nShifts} ndërrime`);
    }
  }

  async function sendOutboxOverCloud(celesi, num, deviceId, saleBatch, shiftBatch) {
    const items = [
      ...saleBatch.map((x) => ({ kind: "sale", payload: x.payload })),
      ...shiftBatch.map((x) => ({ kind: "shift", payload: x.payload })),
    ];
    const pushRes = await terminalRelay.pushQueueItems({
      celesi,
      deviceId,
      registerNumber: num,
      items,
      presence: registerReportStatus(num, "cloud"),
    });
    const queueIds = (pushRes?.ids || []).map(Number).filter((n) => n > 0);
    if (queueIds.length && typeof db.setRelayLastPushedQueueId === "function") {
      db.setRelayLastPushedQueueId(Math.max(...queueIds));
    }
    db.markLanOutboxSent([...saleBatch, ...shiftBatch].map((x) => x.id));
    if (pushRes?.primary_last_seen_at) {
      const online = terminalRelay.isMasterPrimaryOnlineOnCloud();
      console.log(
        `[relay] → Kryesore (cloud): ${saleBatch.length} shitje, ${shiftBatch.length} ndërrime` +
          (online ? " — Kryesorja online në cloud" : ""),
      );
    } else {
      console.log(`[relay] → Kryesore (cloud): ${saleBatch.length} shitje, ${shiftBatch.length} ndërrime`);
    }
  }

  function buildCloudPresencePayload(registerNumber) {
    return {
      ...registerReportStatus(registerNumber, "cloud"),
      online: true,
    };
  }

  async function sendCloudPresenceHeartbeat(celesi, num, deviceId) {
    await terminalRelay.pushPresence({
      celesi,
      deviceId,
      registerNumber: num,
      presence: buildCloudPresencePayload(num),
    });
    lastCloudPresenceAt = Date.now();
  }

  async function flushLanOutboxToMaster() {
    if (terminalRegisterNumber() < 2 || outboxBusy) return;
    const app = electronApp();
    const celesi = storedLicenseKeyForCloud();
    if (!app || !celesi) return;

    if (typeof db.syncLanShiftSnapshots === "function") {
      try {
        db.syncLanShiftSnapshots();
      } catch {
        /* ignore */
      }
    }

    const pending = db
      .getLanOutboxPending(50)
      .filter((r) => (r.kind === "sale" || r.kind === "shift") && r.payload);

    const num = terminalRegisterNumber();
    const deviceId = String(license.getMachineId() || "").trim().toUpperCase();

    if (!pending.length) {
      if (Date.now() - lastCloudPresenceAt < CLOUD_PRESENCE_HEARTBEAT_MS) return;
      outboxBusy = true;
      try {
        const base = await masterLanLocator.locate();
        if (base) {
          try {
            await sendOutboxOverLan(base, celesi, num, deviceId, [], []);
            masterLanLocator.markOk();
            lastCloudPresenceAt = Date.now();
            return;
          } catch {
            masterLanLocator.markFailed(new Error("presence LAN dështoi"));
          }
        }
        await sendCloudPresenceHeartbeat(celesi, num, deviceId);
      } catch (e) {
        if (e.code !== "RELAY_UNAVAILABLE") {
          console.warn("[relay-presence] heartbeat:", e.message || e);
        }
      } finally {
        outboxBusy = false;
      }
      return;
    }
    const saleBatch = pending.filter((x) => x.kind === "sale");
    const shiftBatch = pending.filter((x) => x.kind === "shift");

    outboxBusy = true;
    try {
      const base = await masterLanLocator.locate();
      if (base) {
        try {
          await sendOutboxOverLan(base, celesi, num, deviceId, saleBatch, shiftBatch);
          masterLanLocator.markOk();
          return;
        } catch (e) {
          masterLanLocator.markFailed(e);
          console.warn(`[lan-outbox] Kryesore ${base}: ${e.message} — provoj përmes cloud-it`);
        }
      } else {
        const st = masterLanLocator.status();
        if (st.last_error) console.warn(`[lan-outbox] Kryesore pa LAN (${st.last_error}) — provoj cloud`);
        else console.warn("[lan-outbox] Kryesore pa ping LAN — provoj përmes cloud-it");
      }

      try {
        await sendOutboxOverCloud(celesi, num, deviceId, saleBatch, shiftBatch);
      } catch (e) {
        const transient = e.code === "RELAY_UNAVAILABLE" || Number(e.status) >= 500;
        if (!transient) {
          db.markLanOutboxFailed(
            pending.map((x) => x.id),
            `pa LAN dhe pa cloud: ${e.message || String(e)}`,
          );
        } else {
          console.warn(
            `[relay] cloud përkohësisht i padisponueshëm — ${pending.length} rreshta mbeten në radhë`,
          );
        }
        if (e.code === "TERMINAL_REVOKED" || e.code === "TERMINAL_UNKNOWN") {
          console.warn(`[relay] ${e.message}`);
        }
      }
    } catch (e) {
      db.markLanOutboxFailed(pending.map((x) => x.id), e.message || String(e));
      console.warn("[lan-outbox]", e.message || e);
    } finally {
      outboxBusy = false;
    }
  }

  async function syncCatalogFromCloudSnapshots({ force = false } = {}) {
    if (terminalRegisterNumber() < 2) return;
    if (!force && Date.now() - cloudSnapshotAt < CLOUD_SNAPSHOT_MIN_MS) return;
    const app = electronApp();
    const celesi = storedLicenseKeyForCloud();
    if (!app || !celesi) return;
    cloudSnapshotAt = Date.now();
    const deviceId = String(license.getMachineId() || "").trim().toUpperCase();
    try {
      const r = await terminalRelay.fetchSnapshots({
        celesi,
        deviceId,
        have: cloudSnapshotHave,
      });
      const s = r.snapshots || {};
      const nowIso = new Date().toISOString();
      if (s.master?.data) {
        masterLanLocator.setPublished(s.master.data);
        cloudSnapshotHave.master = s.master.hash;
      }
      if (s.staff?.data && Array.isArray(s.staff.data.staff)) {
        const result = db.replaceStaffFromMaster(s.staff.data.staff);
        if (result.ok && (result.added || result.updated || result.deactivated)) {
          console.log(
            `[relay-snapshots] staff nga cloud: +${result.added} ~${result.updated} -${result.deactivated}`,
          );
        }
        if (result.ok) {
          cloudSnapshotHave.staff = s.staff.hash;
          lanPullStatus.staff_at = nowIso;
          lanPullStatus.via = "cloud";
        }
      } else if (s.staff?.error) {
        console.warn(`[relay-snapshots] staff: ${s.staff.error}`);
      }
      if (s.menu?.data) {
        const d = s.menu.data;
        if (Array.isArray(d.categories) && Array.isArray(d.items)) {
          const result = db.replaceMenuFromMaster({
            categories: d.categories,
            items: d.items,
          });
          if (result.ok) {
            const c = result.categories;
            const m = result.items;
            console.log(
              `[relay-snapshots] menu nga cloud: kat +${c.added} ~${c.updated}, art +${m.added} ~${m.updated}`,
            );
            cloudSnapshotHave.menu = s.menu.hash;
            lanPullStatus.menu_at = nowIso;
            lanPullStatus.via = "cloud";
          }
        }
      } else if (s.menu?.error) {
        console.warn(`[relay-snapshots] menu: ${s.menu.error}`);
      }
      if (s.services?.data) {
        const d = s.services.data;
        const result = db.replaceServicesFromMaster({
          categories: d.categories,
          services: d.services,
        });
        if (result.ok) {
          const sv = result.services;
          console.log(
            `[relay-snapshots] shërbime nga cloud: +${sv.added} ~${sv.updated} -${sv.deactivated}`,
          );
          cloudSnapshotHave.services = s.services.hash;
          lanPullStatus.services_at = nowIso;
          lanPullStatus.via = "cloud";
        }
      } else if (s.services?.error) {
        console.warn(`[relay-snapshots] shërbime: ${s.services.error}`);
      }
      const stockData = s.stock?.data;
      const ackMap = stockData?.relay_acked_through;
      if (ackMap && typeof ackMap === "object" && typeof db.bumpRelayAckedThrough === "function") {
        const dev = ownDeviceId();
        const ackId = Math.floor(Number(ackMap[dev]) || 0);
        if (ackId > 0) db.bumpRelayAckedThrough(dev, ackId);
      }
      if (shouldSkipStockSync(ackMap)) {
        markStockSkippedPending();
      } else if (stockData && Array.isArray(stockData.items)) {
        const pending = pendingLanSalesCount();
        if (pending > 0) {
          lanPullStatus.stock_skipped_pending = Math.max(1, pending);
        } else {
          const result = db.replaceStockFromMaster(stockData.items);
          if (result.ok) {
            if (result.updated) {
              console.log(`[relay-snapshots] stok nga cloud: ${result.updated} rreshta`);
            }
            cloudSnapshotHave.stock = s.stock.hash;
            lanPullStatus.stock_at = nowIso;
            lanPullStatus.stock_skipped_pending = 0;
            lanPullStatus.via = "cloud";
          }
        }
      } else if (s.stock?.error) {
        console.warn(`[relay-snapshots] stok: ${s.stock.error}`);
      }
    } catch (e) {
      if (e.code !== "RELAY_UNAVAILABLE") {
        console.warn("[relay-snapshots] Arka 2+ (cloud):", e.message || e);
      }
    }
  }

  async function syncAllFromMaster() {
    if (terminalRegisterNumber() < 2) return;
    if (busy) return;
    const celesi = storedLicenseKeyForCloud();
    if (!celesi) return;

    busy = true;
    try {
      const up = await pingMasterRegister(celesi);
      if (up) {
        await syncStaffFromMaster();
        await syncMenuFromMaster();
        await syncStockFromMaster();
        await syncServicesFromMaster();
      } else {
        await syncCatalogFromCloudSnapshots();
      }
      await flushLanOutboxToMaster();
    } finally {
      busy = false;
    }
  }

  function startTerminalLanSync() {
    const n = terminalRegisterNumber();
    if (n < 2) return;
    console.log(
      `[lan-sync] Arka ${n}: pull nga Kryesorja çdo ${LAN_SYNC_INTERVAL_MS / 1000}s (LAN multi-IP + cloud fallback)`,
    );
    setTimeout(() => {
      syncAllFromMaster().catch((e) => console.warn("[lan-sync]", e.message || e));
    }, 6000);
    setTimeout(() => {
      syncCatalogFromCloudSnapshots({ force: true }).catch((e) =>
        console.warn("[relay-snapshots]", e.message || e),
      );
    }, 4000);
    setInterval(() => {
      syncAllFromMaster().catch((e) => console.warn("[lan-sync]", e.message || e));
    }, LAN_SYNC_INTERVAL_MS);
    setTimeout(() => {
      flushLanOutboxToMaster().catch((e) => console.warn("[lan-outbox]", e.message || e));
    }, 8000);
    setInterval(() => {
      flushLanOutboxToMaster().catch((e) => console.warn("[lan-outbox]", e.message || e));
    }, LAN_OUTBOX_INTERVAL_MS);
  }

  function getCloudRelayLinkStatus() {
    return {
      primary_last_seen_at: terminalRelay.getMasterPrimaryLastSeenAt(),
      primary_cloud_online: terminalRelay.isMasterPrimaryOnlineOnCloud(),
      pull: { ...lanPullStatus },
      lan: masterLanLocator.status(),
    };
  }

  return {
    syncStaffFromMaster,
    syncMenuFromMaster,
    syncStockFromMaster,
    syncServicesFromMaster,
    syncAllFromMaster,
    syncCatalogFromCloudSnapshots,
    flushLanOutboxToMaster,
    startTerminalLanSync,
    pingMasterRegister,
    masterLanLocator,
    getCloudRelayLinkStatus,
  };
}

module.exports = {
  createTerminalLanSync,
  createMasterLanLocator,
  LAN_SYNC_INTERVAL_MS,
  LAN_OUTBOX_INTERVAL_MS,
};
