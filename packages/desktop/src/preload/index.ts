import { contextBridge, ipcRenderer } from "electron";

const electronAPI = {
  getDesktopSources: () => ipcRenderer.invoke("audio:get-desktop-sources"),
  checkPermissions: () => ipcRenderer.invoke("audio:check-permissions"),
  requestMicPermission: () => ipcRenderer.invoke("audio:request-mic-permission"),
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
