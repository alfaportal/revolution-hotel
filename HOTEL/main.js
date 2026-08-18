/**
 * Revolution HOTEL — Electron entry
 * Integrity (prod) → Hardware lock HotelLicense (prod) → DB ready → server → UI → security-alert
 */
const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const pkg = require("./package.json");

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
      alwaysOnTop: true,
      skipTaskbar: true,
      backgroundColor: "#0b1220",
      icon: path.join(__dirname, "build", "icon.ico"),
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
    splashWindow.loadFile(path.join(__dirname, "public", "splash.html")).catch(() => {
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
      createSplash();
      startupMark("splash");
      const userData = path.join(app.getPath("appData"), "Revolution HOTEL");
      fs.mkdirSync(userData, { recursive: true });
      try {
        app.setPath("userData", userData);
      } catch {
        /* ignore */
      }
      process.env.DB_PATH = path.join(userData, "hotel.db");

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

      /* Hardware lock lokal (HotelLicense) — SHA256(motherboard+disk+install-salt). JO cloud.
         HOTEL nuk është regjistruar te licencat, pra nuk ka kod për të kërkuar:
         kthe në true vetëm kur klientët e HOTEL-it të kenë licencë. */
      const HOTEL_LICENSE_CODE_REQUIRED = false;
      if (isProd && HOTEL_LICENSE_CODE_REQUIRED) {
        const licenseGuard = require("./fiscal/license-guard");
        let hw = { ok: false, grace: null };
        try {
          hw = await licenseGuard.ensureHardwareLicense(app);
          if (typeof hw === "boolean") hw = { ok: hw, grace: null };
        } catch (e) {
          dialog.showErrorBox("Licenca", e.message || String(e));
          app.quit();
          return;
        }
        if (!hw || !hw.ok) {
          app.quit();
          return;
        }
        global.__hwLicenseGrace = licenseGuard.getGraceBannerInfo(app);
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

      const logoPath = path.join(__dirname, "public", "img", "revolution-logo.png");
      const iconIco = path.join(__dirname, "build", "icon.ico");
      mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 900,
        minHeight: 600,
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
        },
      });
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
      mainWindow.webContents.on("did-fail-load", (_e, _code, _desc, _url, isMainFrame) => {
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
