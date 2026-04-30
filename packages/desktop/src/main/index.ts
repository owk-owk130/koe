import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
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
import { createTray, updateTrayState } from "./tray";
import { createPopoverWindow, togglePopover, getPopoverWindow } from "./popover";

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
