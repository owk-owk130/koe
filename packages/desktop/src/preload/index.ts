import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "~/shared/ipc-channels";
import type { ElectronAPI } from "~/shared/ipc-channels";

const electronAPI: ElectronAPI = {
  // Auth
  getToken: () => ipcRenderer.invoke(IPC.AUTH_GET_TOKEN),
  saveToken: (token) => ipcRenderer.invoke(IPC.AUTH_SAVE_TOKEN, token),
  clearToken: () => ipcRenderer.invoke(IPC.AUTH_CLEAR_TOKEN),
  getUser: () => ipcRenderer.invoke(IPC.AUTH_GET_USER),

  // Recording
  notifyRecordingState: (state) => ipcRenderer.invoke(IPC.RECORDING_STATE_CHANGED, state),
  saveRecording: (buffer, filename) => ipcRenderer.invoke(IPC.RECORDING_SAVE, buffer, filename),

  // Tray → Renderer events
  onToggleRecording: (callback) => {
    const handler = () => callback();
    ipcRenderer.on(IPC.TRAY_TOGGLE_RECORDING, handler);
    return () => ipcRenderer.removeListener(IPC.TRAY_TOGGLE_RECORDING, handler);
  },
  onOpenWindow: (callback) => {
    const handler = (_: unknown, route: string) => callback(route);
    ipcRenderer.on(IPC.TRAY_OPEN_WINDOW, handler);
    return () => ipcRenderer.removeListener(IPC.TRAY_OPEN_WINDOW, handler);
  },

  // File system
  selectAudioFile: () => ipcRenderer.invoke(IPC.FS_SELECT_AUDIO_FILE),
  saveAudioFile: (buffer, defaultName) =>
    ipcRenderer.invoke(IPC.FS_SAVE_AUDIO_FILE, buffer, defaultName),
  readFile: (path) => ipcRenderer.invoke(IPC.FS_READ_FILE, path),
  getFileInfo: (path) => ipcRenderer.invoke(IPC.FS_GET_FILE_INFO, path),

  // Audio
  getDesktopSources: () => ipcRenderer.invoke(IPC.AUDIO_GET_DESKTOP_SOURCES),
  checkPermissions: () => ipcRenderer.invoke(IPC.AUDIO_CHECK_PERMISSIONS),
  requestMicPermission: () => ipcRenderer.invoke(IPC.AUDIO_REQUEST_MIC_PERMISSION),

  // App
  getVersion: () => ipcRenderer.invoke(IPC.APP_GET_VERSION),
  openExternal: (url) => ipcRenderer.invoke(IPC.APP_OPEN_EXTERNAL, url),
  openScreenRecordingSettings: () => ipcRenderer.invoke(IPC.APP_OPEN_SCREEN_RECORDING_SETTINGS),

  // Upload
  multipartUpload: (filePath, token) => ipcRenderer.invoke(IPC.UPLOAD_MULTIPART, filePath, token),

  // Settings
  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  saveSettings: (settings) => ipcRenderer.invoke(IPC.SETTINGS_SAVE, settings),
  getApiKeys: () => ipcRenderer.invoke(IPC.SETTINGS_GET_API_KEYS),
  saveApiKeys: (keys) => ipcRenderer.invoke(IPC.SETTINGS_SAVE_API_KEYS, keys),
  saveAll: (payload) => ipcRenderer.invoke(IPC.SETTINGS_SAVE_ALL, payload),
  isConfigured: () => ipcRenderer.invoke(IPC.SETTINGS_IS_CONFIGURED),

  // Sidecar
  getSidecarStatus: () => ipcRenderer.invoke(IPC.SIDECAR_STATUS),
  onSidecarStatusChanged: (callback) => {
    const handler = (_: unknown, state: import("~/shared/ipc-channels").SidecarState) =>
      callback(state);
    ipcRenderer.on(IPC.SIDECAR_STATUS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.SIDECAR_STATUS_CHANGED, handler);
  },

  // Local processing
  processLocal: (audioFilePath) => ipcRenderer.invoke(IPC.LOCAL_PROCESS, audioFilePath),

  // Local history
  listHistory: () => ipcRenderer.invoke(IPC.HISTORY_LIST),
  getHistoryJob: (id) => ipcRenderer.invoke(IPC.HISTORY_GET, id),
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
