import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  shell,
  systemPreferences,
} from "electron";
import { randomUUID } from "node:crypto";
import { join } from "path";
import { readFile, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { is } from "@electron-toolkit/utils";
import Store from "electron-store";
import { isTokenExpired, parseUser } from "@koe/shared";
import { IPC } from "~/shared/ipc-channels";
import type {
  AppSettings,
  ApiKeysInput,
  LocalJobDetailPayload,
  LocalJobSummary,
  LocalProcessResult,
} from "~/shared/ipc-channels";
import { createTray, updateTrayState } from "./tray";
import { closeDesktopDatabase, getDesktopDatabase, initDesktopDatabase } from "./db";
import { getLocalJob, listLocalJobs, saveLocalJob } from "./db/job-store";
import {
  getSettings,
  saveSettings as saveSettingsToStore,
  getApiKeys,
  saveApiKeys as saveApiKeysToStore,
  isConfigured,
} from "./settings";
import {
  startSidecar,
  stopSidecar,
  restartSidecar,
  getSidecarState,
  setOnStateChange,
  processAudio,
} from "./sidecar";

const store = new Store<{ token?: string }>({ encryptionKey: "koe-desktop" });

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 680,
    title: "koe",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  // macOS: hide window instead of closing
  mainWindow.on("close", (e) => {
    if (process.platform === "darwin" && !isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

// ---- Auth IPC ----

ipcMain.handle(IPC.AUTH_GET_TOKEN, () => {
  const token = store.get("token");
  if (!token || isTokenExpired(token)) return null;
  return token;
});

ipcMain.handle(IPC.AUTH_SAVE_TOKEN, (_, token: string) => {
  store.set("token", token);
});

ipcMain.handle(IPC.AUTH_CLEAR_TOKEN, () => {
  store.delete("token");
});

ipcMain.handle(IPC.AUTH_GET_USER, () => {
  const token = store.get("token");
  if (!token || isTokenExpired(token)) return null;
  return parseUser(token);
});

// ---- Audio IPC ----

ipcMain.handle(IPC.AUDIO_GET_DESKTOP_SOURCES, async () => {
  const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });
  return sources.map((s) => ({ id: s.id, name: s.name, display_id: s.display_id }));
});

ipcMain.handle(IPC.AUDIO_CHECK_PERMISSIONS, () => {
  if (process.platform !== "darwin") {
    return { microphone: true, screen: true };
  }
  return {
    microphone: systemPreferences.getMediaAccessStatus("microphone") === "granted",
    screen: systemPreferences.getMediaAccessStatus("screen") === "granted",
  };
});

ipcMain.handle(IPC.AUDIO_REQUEST_MIC_PERMISSION, () => {
  if (process.platform !== "darwin") return true;
  return systemPreferences.askForMediaAccess("microphone");
});

// ---- Recording IPC ----

ipcMain.handle(IPC.RECORDING_STATE_CHANGED, (_, state: string) => {
  updateTrayState(state as import("../shared/ipc-channels").RecordingState, mainWindow);
});

ipcMain.handle(IPC.RECORDING_SAVE, async (_, buffer: ArrayBuffer, filename: string) => {
  const filePath = join(tmpdir(), `koe-${Date.now()}-${filename}`);
  await writeFile(filePath, Buffer.from(buffer));
  return filePath;
});

// ---- File system IPC ----

ipcMain.handle(IPC.FS_SAVE_AUDIO_FILE, async (_, buffer: ArrayBuffer, defaultName: string) => {
  if (!mainWindow) return false;
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [{ name: "Audio", extensions: ["webm"] }],
  });
  if (result.canceled || !result.filePath) return false;
  await writeFile(result.filePath, Buffer.from(buffer));
  return true;
});

ipcMain.handle(IPC.FS_SELECT_AUDIO_FILE, async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: "Audio", extensions: ["mp3", "wav", "m4a", "ogg", "flac", "webm"] }],
    properties: ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const info = await stat(filePath);
  return {
    name: filePath.split("/").pop() ?? filePath,
    size: info.size,
    path: filePath,
  };
});

ipcMain.handle(IPC.FS_READ_FILE, async (_, path: string) => {
  const buf = await readFile(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

ipcMain.handle(IPC.FS_GET_FILE_INFO, async (_, path: string) => {
  const info = await stat(path);
  return {
    name: path.split("/").pop() ?? path,
    size: info.size,
    path,
  };
});

// ---- App IPC ----

ipcMain.handle(IPC.APP_GET_VERSION, () => app.getVersion());

ipcMain.handle(IPC.APP_OPEN_EXTERNAL, (_, url: string) => shell.openExternal(url));

ipcMain.handle(IPC.APP_OPEN_SCREEN_RECORDING_SETTINGS, () =>
  shell.openExternal(
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  ),
);

// ---- Upload IPC (stub — full implementation in Step 9) ----

ipcMain.handle(IPC.UPLOAD_MULTIPART, async (_, _filePath: string, _token: string) => {
  // TODO: Implement multipart upload from main process
  return { jobId: "", status: "not_implemented" };
});

// ---- Settings IPC ----

ipcMain.handle(IPC.SETTINGS_GET, () => getSettings());

ipcMain.handle(IPC.SETTINGS_SAVE, (_, settings: AppSettings) => {
  saveSettingsToStore(settings);
});

ipcMain.handle(IPC.SETTINGS_GET_API_KEYS, () => getApiKeys());

ipcMain.handle(IPC.SETTINGS_SAVE_API_KEYS, (_, keys: ApiKeysInput) => {
  saveApiKeysToStore(keys);
});

ipcMain.handle(
  IPC.SETTINGS_SAVE_ALL,
  async (_, payload: { settings: AppSettings; apiKeys: ApiKeysInput }) => {
    saveSettingsToStore(payload.settings);
    saveApiKeysToStore(payload.apiKeys);
    await restartSidecar();
  },
);

ipcMain.handle(IPC.SETTINGS_IS_CONFIGURED, () => isConfigured());

// ---- Sidecar IPC ----

ipcMain.handle(IPC.SIDECAR_STATUS, () => getSidecarState());

// ---- Local process IPC ----

type SidecarResult = Omit<LocalProcessResult, "jobId">;

ipcMain.handle(IPC.LOCAL_PROCESS, async (_, audioFilePath: string): Promise<LocalProcessResult> => {
  const result = (await processAudio(audioFilePath)) as SidecarResult;
  const jobId = randomUUID();
  const filename = audioFilePath.split(/[/\\]/).pop() ?? "audio";

  const { db } = getDesktopDatabase();
  saveLocalJob(db, {
    id: jobId,
    audioFilename: filename,
    summary: result.summary,
    transcript: result.transcript,
    topics: result.topics,
    chunks: result.chunks,
  });

  return { jobId, ...result };
});

// ---- Local history IPC ----

ipcMain.handle(IPC.HISTORY_LIST, (): LocalJobSummary[] => {
  const { db } = getDesktopDatabase();
  return listLocalJobs(db).map((row) => ({
    id: row.id,
    status: row.status,
    audioKey: row.audioKey,
    audioDurationSec: row.audioDurationSec,
    summary: row.summary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
});

ipcMain.handle(IPC.HISTORY_GET, (_, id: string): LocalJobDetailPayload | null => {
  const { db } = getDesktopDatabase();
  const detail = getLocalJob(db, id);
  if (!detail) return null;
  return {
    job: {
      id: detail.job.id,
      status: detail.job.status,
      audioKey: detail.job.audioKey,
      audioDurationSec: detail.job.audioDurationSec,
      summary: detail.job.summary,
      createdAt: detail.job.createdAt,
      updatedAt: detail.job.updatedAt,
    },
    topics: detail.topics.map((t) => ({
      id: t.id,
      topicIndex: t.topicIndex,
      title: t.title,
      summary: t.summary,
      detail: t.detail,
      startSec: t.startSec,
      endSec: t.endSec,
      transcript: t.transcript,
    })),
    chunks: detail.chunks.map((c) => ({
      id: c.id,
      chunkIndex: c.chunkIndex,
      startSec: c.startSec,
      endSec: c.endSec,
      transcript: c.transcript,
    })),
  };
});

// ---- App lifecycle ----

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    initDesktopDatabase(join(app.getPath("userData"), "koe.db"));

    createWindow();
    createTray(mainWindow);

    // Notify renderer of sidecar status changes
    setOnStateChange((state) => {
      mainWindow?.webContents.send(IPC.SIDECAR_STATUS_CHANGED, state);
    });

    // Auto-start sidecar if configured
    if (isConfigured()) {
      await startSidecar();
    }
  });

  app.on("activate", () => {
    // macOS: re-show window when dock icon clicked
    if (mainWindow) {
      mainWindow.show();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", async () => {
    isQuitting = true;
    await stopSidecar();
    closeDesktopDatabase();
  });
}
