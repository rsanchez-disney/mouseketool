import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  minimize: () => ipcRenderer.send("window-minimize"),
  maximize: () => ipcRenderer.send("window-maximize"),
  close: () => ipcRenderer.send("window-close"),
  setTitleBarOverlay: (options: { color: string; symbolColor: string }) => {
    ipcRenderer.send("set-title-bar-overlay", options);
  },
});

window.addEventListener("DOMContentLoaded", () => {
  document.body.classList.add("electron-app");
});
