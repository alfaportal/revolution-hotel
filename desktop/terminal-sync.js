/**
 * Arka 2+ — pull stafi, menusë, stokut dhe shërbimeve nga Kryesorja përmes LAN (.terminal-lan.json).
 */
const license = require("./license");
const cloudHealth = require("./cloud-health");

const LAN_SYNC_INTERVAL_MS = 30 * 1000;
const LAN_OUTBOX_INTERVAL_MS = 10 * 1000;
const LAN_GET_TIMEOUT_MS = 15000;
const LAN_PROBE_TIMEOUT_MS = 2500;
const LAN_OK_TTL_MS = 60 * 1000;
const LAN_RETRY_MS = 60 * 1000;
const LAN_DEFAULT_PORT = 3001;

function createMasterLanLocator(deps) {
  const { electronApp, storedLicenseKeyForCloud } = deps;
  return createLanLocator({
    readSaved: () => license.readTerminalLan(electronApp()),
    writeSaved: (host, port) => {
      license.writeTerminalLan(electronApp(), host, port);
      console.log(`[lan] Kryesorja u gjet te ${host}:${port} — adresa u ruajt`);
    },
    readRecentHosts: () => license.readTerminalLanRecentHosts(electronApp()),
    pushRecentHost: (host, port) => license.pushTerminalLanRecentHost(electronApp(), host, port),
    getCelesi: () => storedLicenseKeyForCloud(),
    defaultPort: LAN_DEFAULT_PORT,
  });
}

function createLanLocator({
  readSaved,
  writeSaved,
  getCelesi,
  readRecentHosts,
  pushRecentHost,
  defaultPort = LAN_DEFAULT_PORT,
  requestOnce = cloudHealth.requestJsonOnce,
  now = Date.now,
}) {
  const state = {
    base: null,
    host: null,
    okAt: 0,
    retryAt: 0,
    lastError: null,
  };

  function portOrDefault(port, savedPort) {
    const p = Math.floor(Number(port) || 0);
    if (p >= 1) return p;
    const s = Math.floor(Number(savedPort) || 0);
    if (s >= 1) return s;
    return defaultPort;
  }

  function candidates() {
    const out = [];
    const seen = new Set();
    const saved = readSaved() || {};
    const add = (host, port) => {
      const h = String(host || "").trim();
      const p = portOrDefault(port, saved.port);
      if (!h) return;
      const k = `${h}:${p}`;
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ host: h, port: p });
    };
    add(saved.host, saved.port);
    for (const h of readRecentHosts?.() || []) add(h, saved.port);
    return out;
  }

  function isMasterPing(parsed) {
    if (!parsed || parsed.ok !== true) return false;
    const code = String(parsed.role_code || "").trim().toLowerCase();
    if (code === "arka1") return true;
    const role = String(parsed.role || "").trim().toLowerCase();
    if (role === "kryesore" || role === "arka1") return true;
    return false;
  }

  async function probe(c, celesi) {
    const base = `http://${c.host}:${c.port}`;
    const headers = { "x-license-key": celesi };
    const qs = `?celesi=${encodeURIComponent(celesi)}`;
    const r = await requestOnce("GET", base, `/api/terminal/ping${qs}`, null, LAN_PROBE_TIMEOUT_MS, headers);
    if (r.status !== 200) return false;
    let parsed = {};
    try {
      parsed = JSON.parse(r.data || "{}");
    } catch {
      parsed = {};
    }
    return isMasterPing(parsed);
  }

  async function locate() {
    const t = now();
    if (state.base && t - state.okAt < LAN_OK_TTL_MS) return state.base;
    if (!state.base && t < state.retryAt) return null;
    const celesi = getCelesi();
    if (!celesi) return null;
    const saved = readSaved() || {};
    for (const c of candidates()) {
      try {
        if (await probe(c, celesi)) {
          state.base = `http://${c.host}:${c.port}`;
          state.host = c.host;
          state.okAt = now();
          state.lastError = null;
          try {
            pushRecentHost?.(c.host, c.port);
          } catch {
            /* ignore */
          }
          if (String(saved.host || "") !== c.host || portOrDefault(saved.port, null) !== c.port) {
            try {
              writeSaved(c.host, c.port);
            } catch {
              /* ignore */
            }
          }
          return state.base;
        }
        state.lastError = `${c.host}:${c.port} nuk u përgjigj si Kryesore`;
      } catch (e) {
        state.lastError = `${c.host}:${c.port} ${e.message || e}`;
      }
    }
    state.base = null;
    state.host = null;
    state.retryAt = now() + LAN_RETRY_MS;
    return null;
  }

  return {
    locate,
    markOk() {
      if (state.base) state.okAt = now();
    },
    markFailed(err) {
      state.lastError = err ? String(err.message || err) : state.lastError;
      state.base = null;
      state.retryAt = now() + LAN_RETRY_MS;
    },
    status() {
      return {
        base: state.base,
        host: state.host,
        last_error: state.lastError,
      };
    },
  };
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
  const lanPullStatus = {
    staff_at: null,
    menu_at: null,
    stock_at: null,
    stock_skipped_pending: 0,
  };

  async function getMasterJson(celesi, apiPath, timeoutMs) {
    const base = await masterLanLocator.locate();
    return getMasterJsonAtBase(base, celesi, apiPath, timeoutMs);
  }

  async function pingMasterRegister() {
    const celesi = storedLicenseKeyForCloud();
    if (!celesi) return false;
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
    if (result.ok) lanPullStatus.staff_at = new Date().toISOString();
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
    masterLanLocator.markOk();
  }

  function pendingLanSalesCount() {
    return typeof db.countPendingLanSales === "function" ? db.countPendingLanSales() : 0;
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
    const result = db.replaceStockFromMaster(res.parsed.items);
    if (result.ok && result.updated) {
      console.log(`[lan-sync] stok nga ${res.base}: ${result.updated} rreshta`);
    }
    if (result.ok) {
      lanPullStatus.stock_at = new Date().toISOString();
      lanPullStatus.stock_skipped_pending = 0;
    }
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
    masterLanLocator.markOk();
  }

  function registerReportStatus(registerNumber) {
    const ver = typeof db.getVersionInfo === "function" ? db.getVersionInfo() : {};
    const pending =
      typeof db.countPendingLanSales === "function" ? db.countPendingLanSales() : 0;
    return {
      register_number: registerNumber,
      app_version: String(ver.app_version || ver.version || "").slice(0, 40),
      pending,
      via: "lan",
      pull: { ...lanPullStatus },
    };
  }

  async function flushLanOutboxToMaster() {
    if (terminalRegisterNumber() < 2 || outboxBusy) return;
    const celesi = storedLicenseKeyForCloud();
    if (!celesi) return;

    if (typeof db.syncLanShiftSnapshots === "function") {
      try {
        db.syncLanShiftSnapshots();
      } catch {
        /* ignore */
      }
    }

    const allPending = db.getLanOutboxPending(50);
    const saleBatch = allPending.filter((r) => r.kind === "sale" && r.payload);
    const shiftBatch = allPending.filter((r) => r.kind === "shift" && r.payload);
    if (!saleBatch.length && !shiftBatch.length) return;

    outboxBusy = true;
    try {
      const base = await masterLanLocator.locate();
      if (!base) return;
      const num = terminalRegisterNumber();
      const deviceId = String(license.getMachineId() || "").trim().toUpperCase();
      const r = await cloudHealth.requestJsonOnce(
        "POST",
        base,
        `/api/terminal/report?celesi=${encodeURIComponent(celesi)}`,
        {
          device_id: deviceId,
          register_number: num,
          sales: saleBatch.map((x) => x.payload),
          shifts: shiftBatch.map((x) => x.payload),
          status: registerReportStatus(num),
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
      masterLanLocator.markOk();
    } catch (e) {
      db.markLanOutboxFailed(
        [...saleBatch, ...shiftBatch].map((x) => x.id),
        e.message || String(e),
      );
      console.warn("[lan-outbox]", e.message || e);
    } finally {
      outboxBusy = false;
    }
  }

  async function syncAllFromMaster() {
    if (terminalRegisterNumber() < 2) return;
    if (busy) return;
    const celesi = storedLicenseKeyForCloud();
    if (!celesi) return;

    busy = true;
    try {
      const up = await pingMasterRegister();
      if (!up) {
        console.warn("[lan-sync] Kryesorja nuk u gjet në LAN — provo përsëri pas pak.");
        return;
      }
      await syncStaffFromMaster();
      await syncMenuFromMaster();
      await syncStockFromMaster();
      await syncServicesFromMaster();
      await flushLanOutboxToMaster();
    } finally {
      busy = false;
    }
  }

  function startTerminalLanSync() {
    const n = terminalRegisterNumber();
    if (n < 2) return;
    console.log(
      `[lan-sync] Arka ${n}: pull nga Kryesorja çdo ${LAN_SYNC_INTERVAL_MS / 1000}s (LAN)`,
    );
    setTimeout(() => {
      syncAllFromMaster().catch((e) => console.warn("[lan-sync]", e.message || e));
    }, 6000);
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

  return {
    syncStaffFromMaster,
    syncMenuFromMaster,
    syncStockFromMaster,
    syncServicesFromMaster,
    syncAllFromMaster,
    flushLanOutboxToMaster,
    pingMasterRegister,
    startTerminalLanSync,
    masterLanLocator,
  };
}

module.exports = {
  createTerminalLanSync,
  createMasterLanLocator,
  createLanLocator,
  LAN_SYNC_INTERVAL_MS,
  LAN_OUTBOX_INTERVAL_MS,
};
