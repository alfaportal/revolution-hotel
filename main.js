/**
 * Revolution HOTEL — Electron entry
 * Integrity → (licenca fikur përkohësisht për test lokal) → DB ready → server → UI
 */
const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

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
let httpServer = null;
let appReadyForQuit = false;

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
      const userData = path.join(app.getPath("appData"), "Revolution HOTEL");
      fs.mkdirSync(userData, { recursive: true });
      try {
        app.setPath("userData", userData);
      } catch {
        /* ignore */
      }
      process.env.DB_PATH = path.join(userData, "hotel.db");

      // Integritet + licencë fikur përkohësisht — prioritet: hapet pa ngrirë

      // Licenca fikur përkohësisht për test lokal

      // DB inline async — pa Worker / pa Atomics.wait
      const database = require("./database");
      try {
        await database.whenReady();
      } catch (e) {
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
      } catch (e) {
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
        title: resolveWindowTitle(),
        backgroundColor: "#0f172a",
        show: true,
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
      try {
        mainWindow.focus();
        mainWindow.moveTop();
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

      mainWindow.webContents.on("did-finish-load", () => {
        refreshWindowTitle();
      });

      mainWindow.on("closed", () => {
        mainWindow = null;
      });

      const url = started.url || `http://127.0.0.1:${started.port}/`;
      try {
        await mainWindow.loadURL(url);
      } catch {
        await new Promise((r) => setTimeout(r, 400));
        await mainWindow.loadURL(url);
      }
      refreshWindowTitle();
      try {
        mainWindow.show();
        mainWindow.focus();
      } catch {
        /* ignore */
      }

      // security-alert flush fikur përkohësisht — mund të ngrisë UI pas hapjes
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
