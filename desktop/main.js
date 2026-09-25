/**
 * Revolution HOTEL — Electron entry
 * Integrity (prod) → Licencë cloud (dialog + poll) → DB ready → server → UI → security-alert
 */
const { app, BrowserWindow, dialog, ipcMain, screen } = require("electron");
const { runProdLicenseDialogUntilOk, loadCloud } = require("./protection/license-boot");
const path = require("path");
const fs = require("fs");
const { joinContent } = require("./app-paths");
const pkg = require("./package.json");

if (!/^1|true|yes|on$/i.test(String(process.env.HOTEL_ATK_SEND_ALLOWED || "").trim())) {
  process.env.FISCAL_LOCAL_RUN = "1";
  process.env.ATK_AUTO_SEND = "0";
}

const REGION = (() => {
  try {
    return require("./region-config");
  } catch {
    return {};
  }
})();

const APP_NAME = REGION.appName || "Revolution HOTEL";
const APP_ID = REGION.appId || "com.revolution.hotel";

if (require("os").platform() === "win32") {
  app.commandLine.appendSwitch("no-sandbox");
}

app.setName(APP_NAME);
if (process.platform === "win32") {
  app.setAppUserModelId(APP_ID);
}

const isProd = app.isPackaged;

if (isProd) {
  try {
    const bad = /--inspect|--require|NODE_OPTIONS/i;
    if (process.env.NODE_OPTIONS && bad.test(process.env.NODE_OPTIONS)) {
      delete process.env.NODE_OPTIONS;
    }
    if (process.env.ELECTRON_RUN_AS_NODE) {
      delete process.env.ELECTRON_RUN_AS_NODE;
    }
  } catch {
    /* ignore */
  }
}

let mainWindow = null;
let splashWindow = null;
let httpServer = null;
let appReadyForQuit = false;
let hotelHttpStarted = null;
let _licenseReopenInProgress = false;
let _licenseUiSnap = "";
const NO_LICENSE_MSG = "Ky program nuk ka licencë aktive. Kontaktoni Revolution Invest.";
const STARTUP_T0 = Date.now();
const startupMarks = [];

function startupMark(label) {
  const ms = Date.now() - STARTUP_T0;
  startupMarks.push({ label, ms });
  console.log(`[startup] ${label} +${ms}ms`);
  return ms;
}

function waitForLocalHttp(port, timeoutMs = 15000) {
  const http = require("http");
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tryOnce = () => {
      if (Date.now() > deadline) {
        resolve(false);
        return;
      }
      const req = http.get(
        { hostname: "127.0.0.1", port, path: "/", timeout: 800 },
        (res) => {
          res.resume();
          resolve(res.statusCode > 0 && res.statusCode < 500);
        },
      );
      req.on("error", () => setTimeout(tryOnce, 150));
      req.on("timeout", () => {
        req.destroy();
        setTimeout(tryOnce, 150);
      });
    };
    tryOnce();
  });
}

function closeSplash() {
  if (!splashWindow) return;
  try {
    if (!splashWindow.isDestroyed()) splashWindow.close();
  } catch {
    /* ignore */
  }
  splashWindow = null;
}

function createSplash() {
  try {
    splashWindow = new BrowserWindow({
      width: 460,
      height: 340,
      frame: false,
      resizable: false,
      movable: true,
      center: true,
      show: false,
      alwaysOnTop: false,
      skipTaskbar: true,
      backgroundColor: "#0b1220",
      icon: joinContent("build", "icon.ico"),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        devTools: false,
      },
    });
    splashWindow.setMenuBarVisibility(false);
    splashWindow.once("ready-to-show", () => {
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.show();
    });
    splashWindow.loadFile(joinContent("public", "splash.html")).catch(() => {
      try {
        splashWindow.show();
      } catch {
        /* ignore */
      }
    });
  } catch (e) {
    console.warn("[startup] splash:", e.message);
  }
}

function getPreloadPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app.asar", "preload.js");
  }
  return path.join(__dirname, "preload.js");
}

function registerAuditExportIpc() {
  ipcMain.handle("audit-export-pick-path", (event, format) => {
    try {
      const { BrowserWindow } = require("electron");
      const { pickAuditSaveDialog } = require("./fiscal/fiscal-audit");
      const win = event?.sender ? BrowserWindow.fromWebContents(event.sender) : null;
      return pickAuditSaveDialog(format, win);
    } catch (e) {
      console.error("[audit-export] Save dialog:", e && e.message ? e.message : e);
      return null;
    }
  });
}

function resolveWindowTitle() {
  try {
    const db = require("./database");
    if (typeof db.getAppWindowTitle === "function") {
      return db.getAppWindowTitle() || APP_NAME;
    }
  } catch {
    /* DB not ready yet */
  }
  return APP_NAME;
}

function refreshWindowTitle() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.setTitle(resolveWindowTitle());
  } catch {
    /* ignore */
  }
}

function broadcastToAllWindows(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      if (!w.isDestroyed()) w.webContents.send(channel, payload);
    } catch {
      /* ignore */
    }
  }
}

async function pushLicenseUiFromCloud() {
  const cloud = loadCloud();
  let st = {};
  try {
    st = (await cloud.getLicenseStatusForApp(app)) || {};
  } catch {
    st = {};
  }
  const key = cloud.readStoredLicense(app) || "";
  const snap = JSON.stringify({ key: key.slice(-8), data_skadimit: st.data_skadimit || null });
  if (snap === _licenseUiSnap) return;
  _licenseUiSnap = snap;
  broadcastToAllWindows("license:package-updated", {
    expires_at: st.data_skadimit || null,
    data_skadimit: st.data_skadimit || null,
    offline_ok: !!st.offline_ok,
  });
  if (key) broadcastToAllWindows("license:key-updated", { celesi: key });
}

function licenseFailReasonFromBeat(beat) {
  const cloud = loadCloud();
  if (cloud.isRevocationCode(beat?.code) || beat?.force_logout) return "revoked";
  if (beat?.code === "EXPIRED") return "expired";
  if (beat?.code === "OFFLINE_EXPIRED") return "offline_expired";
  return "no_license";
}

function startLicenseWatchdogForApp(cloud) {
  try {
    cloud.startLicenseWatchdog(
      app,
      (beat) => {
        if (cloud.isRevocationCode(beat?.code) || beat?.force_factory_reset) {
          reopenLicenseDialog(beat, beat?.message || NO_LICENSE_MSG).catch(() => {});
          return;
        }
        if (beat?.code && cloud.HARD_LICENSE_FAIL_CODES.has(beat.code)) {
          reopenLicenseDialog(beat, beat?.message || NO_LICENSE_MSG).catch(() => {});
        } else if (beat?.valid) {
          pushLicenseUiFromCloud().catch(() => {});
        }
      },
      (beat) => {
        reopenLicenseDialog(beat, beat?.message || NO_LICENSE_MSG).catch(() => {});
      },
    );
  } catch (e) {
    console.warn("[boot] license watchdog:", e.message || e);
  }
}

async function bootHotelLicenseLayers() {
  const cloud = loadCloud();
  cloud.registerInstallContext(app);

  if (!isProd) {
    try {
      cloud.startLicenseWatchdog(
        app,
        (beat) => {
          if (cloud.isRevocationCode(beat?.code)) {
            reopenLicenseDialog(beat, beat?.message || NO_LICENSE_MSG).catch(() => {});
          }
        },
        (beat) => {
          reopenLicenseDialog(beat, beat?.message || NO_LICENSE_MSG).catch(() => {});
        },
      );
    } catch (e) {
      console.warn("[boot] license (dev):", e.message || e);
    }
    return true;
  }

  closeSplash();
  const licenseGuard = require("./fiscal/license-guard");
  let hw = await licenseGuard.ensureHardwareLicense(app, { onBeforeLicenseUi: closeSplash });
  const hwOk = typeof hw === "boolean" ? hw : hw?.ok;
  if (!hwOk) {
    app.quit();
    return false;
  }
  global.__hwLicenseGrace = licenseGuard.getGraceBannerInfo(app);
  await pushLicenseUiFromCloud();
  startLicenseWatchdogForApp(cloud);
  return true;
}

async function reopenLicenseDialog(beat = {}, detail) {
  if (_licenseReopenInProgress) return;
  _licenseReopenInProgress = true;
  const cloud = loadCloud();
  try {
    if (cloud.isRevocationCode(beat?.code) || beat?.force_factory_reset) {
      cloud.purgeAllLicenseArtifacts(app, detail, { allowReactivation: true });
    } else if (beat?.code && cloud.HARD_LICENSE_FAIL_CODES.has(beat.code)) {
      cloud.clearStoredLicense(app);
    }
  } catch (e) {
    console.warn("[license] purge/clear:", e.message || e);
  }
  _licenseUiSnap = "";
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  } catch {
    /* ignore */
  }
  mainWindow = null;

  const reason = licenseFailReasonFromBeat(beat);
  let activated = false;
  try {
    const licenseGuard = require("./fiscal/license-guard");
    activated = await licenseGuard.promptHardwareActivation(app, { reason });
  } catch (e) {
    console.warn("[license] reopen hardware dialog:", e.message || e);
  }
  _licenseReopenInProgress = false;

  if (!activated) {
    app.quit();
    return;
  }

  try {
    const licenseGuard = require("./fiscal/license-guard");
    const hw = await licenseGuard.ensureHardwareLicense(app);
    const hwOk = typeof hw === "boolean" ? hw : hw?.ok;
    if (!hwOk) {
      app.quit();
      return;
    }
    global.__hwLicenseGrace = licenseGuard.getGraceBannerInfo(app);
    await pushLicenseUiFromCloud();
    startLicenseWatchdogForApp(cloud);
    if (hotelHttpStarted) {
      const userData = app.getPath("userData");
      await mountHotelMainWindow(hotelHttpStarted, userData);
    }
  } catch (e) {
    dialog.showErrorBox(APP_NAME, e.message || String(e));
    app.quit();
  }
}

function registerLicenseIpc() {
  const cloud = loadCloud();
  ipcMain.handle("license:status", async () => cloud.getLicenseStatusForApp(app));
  ipcMain.handle("license:activate", async (_e, payload = {}) => {
    const key = String(payload?.license_key || payload?.key || payload || "").trim();
    const contact_email = String(payload?.contact_email || payload?.email || "").trim();
    return cloud.activateWithKey(app, key, { contact_email });
  });
  ipcMain.handle("license:hardware-id", async () => ({
    hardware_id: cloud.getHardwareIdForDisplay(app),
  }));
  ipcMain.handle("license:device-id", async () => ({ device_id: cloud.getMachineId() }));
  ipcMain.handle("license:open-dialog", async () => {
    const licenseGuard = require("./fiscal/license-guard");
    const activated = await licenseGuard.promptHardwareActivation(app, { reason: "no_license" });
    if (activated) {
      await pushLicenseUiFromCloud();
    }
    return { ok: !!activated };
  });
}

async function mountHotelMainWindow(started, userData) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.close();
    } catch {
      /* ignore */
    }
    mainWindow = null;
  }

  const logoPath = joinContent("public", "img", "revolution-logo.png");
  const iconIco = joinContent("build", "icon.ico");
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 800,
    minHeight: 600,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    title: `${resolveWindowTitle()} v${pkg.version || "?"}`,
    backgroundColor: "#0b1220",
    show: false,
    icon: fs.existsSync(iconIco)
      ? iconIco
      : fs.existsSync(logoPath)
        ? logoPath
        : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      devTools: !isProd,
      preload: getPreloadPath(),
    },
  });
  mainWindow.maximize();
  try {
    mainWindow.setMenuBarVisibility(false);
  } catch {
    /* ignore */
  }
  global.__electronMainWindow = mainWindow;

  if (isProd) {
    const reportDevtools = () => {
      try {
        const sec = require("./security-alert");
        sec.reportDevtoolsAttempt(app).catch(() => {});
      } catch {
        /* ignore */
      }
    };
    mainWindow.webContents.on("devtools-opened", () => {
      mainWindow.webContents.closeDevTools();
      reportDevtools();
    });
    mainWindow.webContents.on("context-menu", (e) => {
      e.preventDefault();
    });
    mainWindow.webContents.on("before-input-event", (event, input) => {
      if (input.key === "F12") {
        event.preventDefault();
        reportDevtools();
        return;
      }
      if (
        input.control &&
        input.shift &&
        ["I", "J", "C"].includes(String(input.key || "").toUpperCase())
      ) {
        event.preventDefault();
        reportDevtools();
      }
    });
  }

  appReadyForQuit = true;

  const url = started.url || `http://127.0.0.1:${started.port}/`;
  const httpReady = await waitForLocalHttp(started.port, 15000);
  if (!httpReady) {
    closeSplash();
    dialog.showErrorBox(APP_NAME, "Serveri nuk u nis në kohë");
    app.quit();
    return;
  }
  startupMark("http-ready");

  let mainShown = false;
  const showMainWindow = () => {
    if (mainShown || !mainWindow || mainWindow.isDestroyed()) return;
    const loaded = String(mainWindow.webContents.getURL() || "");
    if (!loaded || loaded === "about:blank") return;
    mainShown = true;
    startupMark("page-ready");
    closeSplash();
    mainWindow.show();
    try {
      mainWindow.focus();
    } catch {
      /* ignore */
    }
    refreshWindowTitle();
    try {
      fs.writeFileSync(
        path.join(userData, "startup-last.json"),
        JSON.stringify({
          ms: Date.now() - STARTUP_T0,
          at: new Date().toISOString(),
          marks: startupMarks,
          mem: process.memoryUsage(),
        }),
        "utf8",
      );
    } catch {
      /* ignore */
    }
  };

  mainWindow.webContents.on("did-finish-load", () => {
    refreshWindowTitle();
    showMainWindow();
  });
  mainWindow.webContents.on("did-fail-load", (_e, _code, _desc, _failedUrl, isMainFrame) => {
    if (!isMainFrame || mainShown) return;
    setTimeout(() => {
      if (!mainShown && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(url).catch(() => {});
      }
    }, 400);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  try {
    await mainWindow.loadURL(url);
  } catch {
    await new Promise((r) => setTimeout(r, 400));
    await mainWindow.loadURL(url).catch(() => {});
  }
  setTimeout(() => {
    if (!mainShown && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(url).catch(() => {});
    }
  }, 4000);
  setTimeout(() => {
    if (!mainShown) {
      closeSplash();
      dialog.showErrorBox(
        APP_NAME,
        "Faqja e hyrjes nuk u hap. Mbylleni programin dhe hapeni përsëri.",
      );
    }
  }, 20000);
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on("before-quit", () => {
    try {
      httpServer?.close();
    } catch {
      /* ignore */
    }
  });

  app.whenReady().then(async () => {
    try {
      if (process.platform === "win32") {
        const { exec } = require("child_process");
        const fwPort = Number(process.env.PORT) || 3001;
        exec(
          `netsh advfirewall firewall add rule name="Revolution HOTEL" dir=in action=allow protocol=tcp localport=${fwPort}`,
          () => {},
        );
      }

      createSplash();
      startupMark("splash");
      const userData = path.join(app.getPath("appData"), "Revolution HOTEL");
      fs.mkdirSync(userData, { recursive: true });
      try {
        app.setPath("userData", userData);
      } catch {
        /* ignore */
      }

      const resetFlag = path.join(userData, ".factory-reset-pending");
      const resetFlagExternal = path.join(
        app.getPath("appData"),
        "RevolutionInvest",
        "hotel-factory-reset-pending",
      );

      const clearFactoryResetFlags = () => {
        try {
          fs.mkdirSync(path.dirname(resetFlagExternal), { recursive: true });
          if (fs.existsSync(resetFlagExternal)) fs.unlinkSync(resetFlagExternal);
        } catch {
          /* ignore */
        }
        try {
          if (fs.existsSync(resetFlag)) fs.unlinkSync(resetFlag);
        } catch {
          /* ignore */
        }
      };

      const wipeLicenseOnlyForFactoryReset = () => {
        try {
          const licenseMod = require(path.join(__dirname, "license"));
          licenseMod.registerInstallContext(app);
          if (typeof licenseMod.wipeAllActivationData === "function") {
            licenseMod.wipeAllActivationData(app);
          }
        } catch (e) {
          console.warn("[factory-reset] vetëm licencë:", e.message || e);
        }
      };

      const factoryResetRequested =
        fs.existsSync(resetFlag) || fs.existsSync(resetFlagExternal);

      if (factoryResetRequested) {
        wipeLicenseOnlyForFactoryReset();
        clearFactoryResetFlags();
      }

      process.env.DB_PATH = path.join(userData, "hotel.db");

      global["__scheduleFactoryResetRelaunch"] = () => {
        try {
          dialog.showMessageBoxSync({
            type: "warning",
            title: APP_NAME,
            message: "Rivendosje licencë",
            detail:
              "Licenca lokale pastrohet (të dhënat e klientit mbeten). Mbyllni dhe riaktivizoni programin.",
            buttons: ["OK"],
          });
        } catch {
          /* ignore */
        }
        wipeLicenseOnlyForFactoryReset();
        clearFactoryResetFlags();
        try {
          httpServer?.close();
        } catch {
          /* ignore */
        }
        app.relaunch();
        app.exit(0);
      };

      /* Shtresa 0: Integrity (prod) — asar / instalim i dëmtuar */
      if (isProd) {
        try {
          const { verifyPackagedIntegrity } = require("./integrity-check");
          const integ = verifyPackagedIntegrity(app);
          if (!integ.ok) {
            closeSplash();
            dialog.showErrorBox(
              "Integriteti i programit",
              (integ.reason || "Kontrolli dështoi.") +
                "\nKontaktoni +383 48707880 dhe riinstaloni Setup zyrtar.",
            );
            app.quit();
            return;
          }
          } catch (e) {
            closeSplash();
            dialog.showErrorBox("Integriteti i programit", e.message || String(e));
          app.quit();
          return;
        }
      }

      registerLicenseIpc();
      const cloud = loadCloud();
      cloud.registerInstallContext(app);
      try {
        const revokeBlock = await cloud.enforceRevokedBlock(app);
        if (revokeBlock.blocked) {
          closeSplash();
          dialog.showErrorBox("Licenca", revokeBlock.message);
          app.quit();
          return;
        }
      } catch (e) {
        closeSplash();
        dialog.showErrorBox("Licenca", cloud.REVOKED_USER_MESSAGE);
        app.quit();
        return;
      }

      if (!(await bootHotelLicenseLayers())) {
        return;
      }

      // DB in-process (db-engine) — await whenReady para serverit
      const database = require("./database");
      try {
        await database.whenReady();
        startupMark("db");
      } catch (e) {
        closeSplash();
        dialog.showErrorBox(
          `${APP_NAME} — Database`,
          `Nuk u nis databaza.\n\n${e.message || e}`,
        );
        app.quit();
        return;
      }

      try {
        const { purgeLegacyAuditNoise } = require("./fiscal/fiscal-audit");
        const purged = purgeLegacyAuditNoise();
        if (!purged.skipped && purged.deleted > 0) {
          console.log(`[hotel] audit log: u fshinë ${purged.deleted} rreshta test/debug`);
        }
      } catch (e) {
        console.warn("[hotel] audit purge:", e.message);
      }

      registerAuditExportIpc();

      const { startServer } = require("./server");
      let started;
      try {
        started = await startServer();
        startupMark("server");
      } catch (e) {
        closeSplash();
        dialog.showErrorBox(
          `${APP_NAME} — Serveri`,
          `Nuk u nis serveri lokal.\n\n${e.message || e}`,
        );
        app.quit();
        return;
      }
      httpServer = started.server;
      hotelHttpStarted = started;
      await mountHotelMainWindow(started, userData);

      /* security-alert: njoftime lokale (queue); cloud post dështon në silent në hotel offline */
      try {
        const sec = require("./security-alert");
        if (typeof sec.startSecurityAlertFlush === "function") {
          setTimeout(() => {
            try {
              sec.startSecurityAlertFlush(app);
            } catch {
              /* ignore */
            }
          }, 2500);
        }
      } catch {
        /* ignore */
      }

      setInterval(() => {
        try {
          const m = process.memoryUsage();
          const rssMb = Math.round(m.rss / 1048576);
          const heapMb = Math.round(m.heapUsed / 1048576);
          console.log(`[mem] rss=${rssMb}MB heap=${heapMb}MB`);
          if (rssMb >= 500) console.warn(`[mem] RAM ${rssMb}MB (>500MB)`);
        } catch {
          /* ignore */
        }
      }, 60000).unref?.();
    } catch (e) {
      dialog.showErrorBox(APP_NAME, e.message || String(e));
      app.quit();
    }
  });

  app.on("window-all-closed", () => {
    if (!appReadyForQuit) return;
    if (process.platform !== "darwin") app.quit();
  });
}
