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

  // Popover
  POPOVER_OPEN_MAIN_WINDOW: "popover:open-main-window",

  // File system
  FS_SELECT_AUDIO_FILE: "fs:select-audio-file",
  FS_SAVE_AUDIO_FILE: "fs:save-audio-file",
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

  // Settings
  SETTINGS_GET: "settings:get",
  SETTINGS_SAVE: "settings:save",
  SETTINGS_GET_API_KEYS: "settings:get-api-keys",
  SETTINGS_SAVE_API_KEYS: "settings:save-api-keys",
  SETTINGS_SAVE_ALL: "settings:save-all",
  SETTINGS_IS_CONFIGURED: "settings:is-configured",

  // Sidecar
  SIDECAR_STATUS: "sidecar:status",
  SIDECAR_STATUS_CHANGED: "sidecar:status-changed",

  // Local processing
  LOCAL_PROCESS: "local:process",

  // Local history (SQLite-backed)
  HISTORY_LIST: "history:list",
  HISTORY_GET: "history:get",
  HISTORY_DELETE: "history:delete",
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

export interface AppSettings {
  whisperBaseUrl: string;
  whisperModel: string;
  geminiModel: string;
}

export interface ApiKeysInput {
  whisperApiKey: string;
  geminiApiKey?: string;
}

export interface ApiKeysOutput {
  whisperApiKey: string | null;
  geminiApiKey: string | null;
}

export interface SaveAllPayload {
  settings: AppSettings;
  apiKeys: ApiKeysInput;
}

export type SidecarStatus = "stopped" | "starting" | "ready" | "error";

export interface SidecarState {
  status: SidecarStatus;
  port?: number;
  error?: string;
}

export interface LocalProcessResult {
  jobId: string;
  transcript: {
    text: string;
    segments: Array<{ text: string; start_sec: number; end_sec: number }>;
  };
  summary: string;
  topics: Array<{
    index: number;
    title: string;
    summary: string;
    detail: string;
    start_sec: number;
    end_sec: number;
    transcript: string;
  }>;
  chunks: Array<{ index: number; start_sec: number; end_sec: number; text: string }>;
}

// Local history payloads (SQLite-backed, one-way cloud sync applies only when logged in)
export interface LocalJobSummary {
  id: string;
  status: string;
  audioKey: string;
  audioDurationSec: number | null;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalJobTopic {
  id: string;
  topicIndex: number;
  title: string;
  summary: string | null;
  detail: string | null;
  startSec: number | null;
  endSec: number | null;
  transcript: string;
}

export interface LocalJobChunk {
  id: string;
  chunkIndex: number;
  startSec: number;
  endSec: number;
  transcript: string | null;
}

export interface LocalJobDetailPayload {
  job: LocalJobSummary;
  topics: LocalJobTopic[];
  chunks: LocalJobChunk[];
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
  saveAudioFile: (buffer: ArrayBuffer, defaultName: string) => Promise<boolean>;
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

  // Popover
  openMainWindow: () => Promise<void>;

  // Settings
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  getApiKeys: () => Promise<ApiKeysOutput>;
  saveApiKeys: (keys: ApiKeysInput) => Promise<void>;
  saveAll: (payload: SaveAllPayload) => Promise<void>;
  isConfigured: () => Promise<boolean>;

  // Sidecar
  getSidecarStatus: () => Promise<SidecarState>;
  onSidecarStatusChanged: (callback: (state: SidecarState) => void) => () => void;

  // Local processing
  processLocal: (audioFilePath: string) => Promise<LocalProcessResult>;

  // Local history
  listHistory: () => Promise<LocalJobSummary[]>;
  getHistoryJob: (id: string) => Promise<LocalJobDetailPayload | null>;
  deleteHistoryJob: (id: string) => Promise<void>;
}
