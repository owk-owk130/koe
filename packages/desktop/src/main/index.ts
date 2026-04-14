import { app, BrowserWindow, ipcMain, desktopCapturer, systemPreferences } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: "koe - Audio PoC",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
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
}

// IPC: Get desktop capturer sources for system audio
ipcMain.handle("audio:get-desktop-sources", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    display_id: s.display_id,
  }));
});

// IPC: Check macOS media access permissions
ipcMain.handle("audio:check-permissions", async () => {
  if (process.platform !== "darwin") {
    return { microphone: true, screen: true };
  }
  const micStatus = systemPreferences.getMediaAccessStatus("microphone");
  const screenStatus = systemPreferences.getMediaAccessStatus("screen");
  return {
    microphone: micStatus === "granted",
    screen: screenStatus === "granted",
  };
});

// IPC: Request microphone permission (macOS)
ipcMain.handle("audio:request-mic-permission", async () => {
  if (process.platform !== "darwin") return true;
  return systemPreferences.askForMediaAccess("microphone");
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});
