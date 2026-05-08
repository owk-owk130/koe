import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
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
import { createTray, updateTrayState } from "./tray";
import { createPopoverWindow, togglePopover, getPopoverWindow } from "./popover";

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

const encryptSecret = (value: string): string => {
  if (!safeStorage.isEncryptionAvailable()) {
    // Fall back to plain text inside the electron-store-encrypted file. The
    // store-level encryption is symmetric with a hardcoded key, so this is
    // weaker than safeStorage — but losing safeStorage is rare on macOS prod
    // builds and we'd rather store the secret than refuse to.
    return `plain:${value}`;
  }
  return `enc:${safeStorage.encryptString(value).toString("base64")}`;
};

const decryptSecret = (stored: string): string | undefined => {
  if (stored.startsWith("plain:")) return stored.slice("plain:".length);
  if (stored.startsWith("enc:")) {
    if (!safeStorage.isEncryptionAvailable()) return undefined;
    try {
      return safeStorage.decryptString(Buffer.from(stored.slice("enc:".length), "base64"));
    } catch {
      return undefined;
    }
  }
  // Legacy / unknown prefix: treat as missing.
  return undefined;
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

const readSecretsStatus = (): AiSecretsStatus => {
  const raw = store.get("secrets") ?? {};
  return {
    geminiApiKey: typeof raw.geminiApiKey === "string" && raw.geminiApiKey.length > 0,
    geminiModel: typeof raw.geminiModel === "string" && raw.geminiModel.length > 0,
    cfApiToken: typeof raw.cfApiToken === "string" && raw.cfApiToken.length > 0,
    cfAccountId: typeof raw.cfAccountId === "string" && raw.cfAccountId.length > 0,
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
}
