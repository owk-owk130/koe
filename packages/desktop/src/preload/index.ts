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
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
