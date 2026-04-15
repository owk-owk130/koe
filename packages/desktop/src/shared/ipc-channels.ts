import type { AuthUser } from "@koe/shared";

// ---- Channel names ----

export const IPC = {
  // Auth
  AUTH_GET_TOKEN: "auth:get-token",
  AUTH_SAVE_TOKEN: "auth:save-token",
  AUTH_CLEAR_TOKEN: "auth:clear-token",
  AUTH_GET_USER: "auth:get-user",

  // Recording
  RECORDING_STATE_CHANGED: "recording:state-changed",
  RECORDING_SAVE: "recording:save",

  // Tray → Renderer
  TRAY_TOGGLE_RECORDING: "tray:toggle-recording",
  TRAY_OPEN_WINDOW: "tray:open-window",

  // File system
  FS_SELECT_AUDIO_FILE: "fs:select-audio-file",
  FS_READ_FILE: "fs:read-file",
  FS_GET_FILE_INFO: "fs:get-file-info",

  // Audio
  AUDIO_GET_DESKTOP_SOURCES: "audio:get-desktop-sources",
  AUDIO_CHECK_PERMISSIONS: "audio:check-permissions",
  AUDIO_REQUEST_MIC_PERMISSION: "audio:request-mic-permission",

  // App
  APP_GET_VERSION: "app:get-version",
  APP_OPEN_EXTERNAL: "app:open-external",
  APP_OPEN_SCREEN_RECORDING_SETTINGS: "app:open-screen-recording-settings",

  // Upload (main process handles large file upload)
  UPLOAD_MULTIPART: "upload:multipart",
} as const;

// ---- Payload types ----

export type RecordingState = "idle" | "recording" | "paused" | "processing";

export interface DesktopSource {
  id: string;
  name: string;
  display_id: string;
}

export interface PermissionStatus {
  microphone: boolean;
  screen: boolean;
}

export interface FileInfo {
  name: string;
  size: number;
  path: string;
}

export interface UploadResult {
  jobId: string;
  status: string;
}

// ---- ElectronAPI type (exposed via contextBridge) ----

export interface ElectronAPI {
  // Auth
  getToken: () => Promise<string | null>;
  saveToken: (token: string) => Promise<void>;
  clearToken: () => Promise<void>;
  getUser: () => Promise<AuthUser | null>;

  // Recording
  notifyRecordingState: (state: RecordingState) => Promise<void>;
  saveRecording: (buffer: ArrayBuffer, filename: string) => Promise<string>;

  // Tray → Renderer events
  onToggleRecording: (callback: () => void) => () => void;
  onOpenWindow: (callback: (route: string) => void) => () => void;

  // File system
  selectAudioFile: () => Promise<FileInfo | null>;
  readFile: (path: string) => Promise<ArrayBuffer>;
  getFileInfo: (path: string) => Promise<FileInfo>;

  // Audio
  getDesktopSources: () => Promise<DesktopSource[]>;
  checkPermissions: () => Promise<PermissionStatus>;
  requestMicPermission: () => Promise<boolean>;

  // App
  getVersion: () => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  openScreenRecordingSettings: () => Promise<void>;

  // Upload
  multipartUpload: (filePath: string, token: string) => Promise<UploadResult>;
}
