import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  safeStorage,
  shell,
  systemPreferences,
} from "electron";
import { join } from "path";
import { readFile, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { is } from "@electron-toolkit/utils";
import Store from "electron-store";
import { isTokenExpired, parseUser } from "@koe/shared";
import { IPC } from "~/shared/ipc-channels";
import type { AiSecrets, AiSecretsStatus } from "~/shared/ipc-channels";
import { createTray, toggleRecording, updateTrayState } from "./tray";
import { createPopoverWindow, togglePopover, getPopoverWindow } from "./popover";

const TOGGLE_RECORDING_SHORTCUT = "CommandOrControl+Shift+K";

// Secrets are persisted as base64-encoded ciphertext from `safeStorage` so the
// raw key bytes never sit in the on-disk JSON. `safeStorage.encryptString` is
// backed by the OS keychain (Keychain on macOS, DPAPI on Windows, libsecret on
// Linux) — losing the OS profile is the only way to recover the raw value.
type SecretsStore = {
  token?: string;
  secrets?: {
    geminiApiKey?: string;
    geminiModel?: string;
    cfApiToken?: string;
    cfAccountId?: string;
  };
};

const store = new Store<SecretsStore>({ encryptionKey: "koe-desktop" });

type SecretField = keyof NonNullable<SecretsStore["secrets"]>;

const SECRET_FIELDS: SecretField[] = ["geminiApiKey", "geminiModel", "cfApiToken", "cfAccountId"];

// Refuse to persist without OS-backed encryption: a hardcoded electron-store
// key is materially weaker than safeStorage and would silently break the
// "OS keychain" guarantee the UI / docs make. Surfaces as an IPC rejection
// the renderer can show.
const encryptSecret = (value: string): string => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "safeStorage is unavailable; refusing to persist BYOK secrets without OS-backed encryption",
    );
  }
  return safeStorage.encryptString(value).toString("base64");
};

const decryptSecret = (stored: string): string | undefined => {
  if (!safeStorage.isEncryptionAvailable()) return undefined;
  try {
    return safeStorage.decryptString(Buffer.from(stored, "base64"));
  } catch {
    return undefined;
  }
};

const readSecrets = (): AiSecrets => {
  const raw = store.get("secrets") ?? {};
  const out: AiSecrets = {};
  for (const field of SECRET_FIELDS) {
    const stored = raw[field];
    if (typeof stored !== "string" || stored.length === 0) continue;
    const decoded = decryptSecret(stored);
    if (decoded !== undefined && decoded.length > 0) {
      out[field] = decoded;
    }
  }
  return out;
};

// Status reflects *usable* secrets, not just "something is on disk". A
// stored value that no longer decrypts (e.g., safeStorage became unavailable)
// is reported as unset so the UI matches what readSecrets() will actually
// return when building request headers.
const isUsableSecret = (stored: unknown): boolean =>
  typeof stored === "string" && stored.length > 0 && decryptSecret(stored) !== undefined;

const readSecretsStatus = (): AiSecretsStatus => {
  const raw = store.get("secrets") ?? {};
  return {
    geminiApiKey: isUsableSecret(raw.geminiApiKey),
    geminiModel: isUsableSecret(raw.geminiModel),
    cfApiToken: isUsableSecret(raw.cfApiToken),
    cfAccountId: isUsableSecret(raw.cfAccountId),
  };
};

const writeSecrets = (patch: AiSecrets): void => {
  const current = store.get("secrets") ?? {};
  const next: SecretsStore["secrets"] = { ...current };
  for (const field of SECRET_FIELDS) {
    if (!(field in patch)) continue;
    const value = patch[field];
    if (value === undefined || value === null || value === "") {
      delete next[field];
    } else {
      next[field] = encryptSecret(value);
    }
  }
  store.set("secrets", next);
};

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

// ---- Secrets IPC ----

ipcMain.handle(IPC.SECRETS_GET, () => readSecrets());

ipcMain.handle(IPC.SECRETS_GET_STATUS, () => readSecretsStatus());

ipcMain.handle(IPC.SECRETS_SET, (_, patch: AiSecrets) => {
  writeSecrets(patch);
});

ipcMain.handle(IPC.SECRETS_CLEAR, () => {
  store.delete("secrets");
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

ipcMain.handle(IPC.RECORDING_STATE_CHANGED, (event, state: string) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  updateTrayState(
    state as import("../shared/ipc-channels").RecordingState,
    mainWindow,
    getPopoverWindow(),
    sourceWindow,
  );
});

ipcMain.handle(IPC.RECORDING_SAVE, async (_, buffer: ArrayBuffer, filename: string) => {
  const filePath = join(tmpdir(), `koe-${Date.now()}-${filename}`);
  await writeFile(filePath, Buffer.from(buffer));
  return filePath;
});

// ---- File system IPC ----

ipcMain.handle(IPC.FS_SAVE_AUDIO_FILE, async (event, buffer: ArrayBuffer, defaultName: string) => {
  const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
  if (!parentWindow) return false;
  const result = await dialog.showSaveDialog(parentWindow, {
    defaultPath: defaultName,
    filters: [{ name: "Audio", extensions: ["webm"] }],
  });
  if (result.canceled || !result.filePath) return false;
  await writeFile(result.filePath, Buffer.from(buffer));
  return true;
});

ipcMain.handle(IPC.FS_SELECT_AUDIO_FILE, async (event) => {
  const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
  if (!parentWindow) return null;
  const result = await dialog.showOpenDialog(parentWindow, {
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

// ---- Popover IPC ----

ipcMain.handle(IPC.POPOVER_OPEN_MAIN_WINDOW, () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
  getPopoverWindow()?.hide();
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

  app.whenReady().then(() => {
    createWindow();
    const popoverWindow = createPopoverWindow();
    createTray({ mainWindow, popoverWindow, togglePopover });

    // register() returns false when the OS or another app already owns the
    // accelerator. Tray menu / popover button still work, so degrade quietly.
    const registered = globalShortcut.register(TOGGLE_RECORDING_SHORTCUT, () => {
      toggleRecording(getPopoverWindow());
    });
    if (!registered) {
      console.warn(`[koe] failed to register global shortcut ${TOGGLE_RECORDING_SHORTCUT}`);
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

  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });
}
