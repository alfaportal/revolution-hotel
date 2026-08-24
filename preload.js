/**
 * preload.js — IPC i sigurt për dialog Save As (audit export).
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hotelElectron", {
  pickAuditSavePath: (format) => ipcRenderer.invoke("audit-export-pick-path", format),
});
