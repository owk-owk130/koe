import { app, Menu, Tray, nativeImage, type BrowserWindow } from "electron";
import { join } from "path";
import type { RecordingState } from "~/shared/ipc-channels";
import { IPC } from "~/shared/ipc-channels";

let tray: Tray | null = null;
let currentState: RecordingState = "idle";
let recordingSourceWindow: BrowserWindow | null = null;

function buildContextMenu(mainWindow: BrowserWindow | null, popoverWindow: BrowserWindow | null) {
  const isRecording = currentState === "recording";

  return Menu.buildFromTemplate([
    {
      label: isRecording ? "録音停止" : "録音開始",
      click: () => {
        if (isRecording && recordingSourceWindow) {
          // Stop: send only to the window that started recording
          recordingSourceWindow.webContents.send(IPC.TRAY_TOGGLE_RECORDING);
        } else {
          // Start: send to popover (primary quick-access window)
          popoverWindow?.webContents.send(IPC.TRAY_TOGGLE_RECORDING);
        }
      },
    },
    { type: "separator" },
    {
      label: "ウィンドウを表示",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    { type: "separator" },
    {
      label: "終了",
      click: () => {
        app.quit();
      },
    },
  ]);
}

function loadTrayIcon(): Electron.NativeImage {
  // In dev, resolve from source build directory; in prod, from extraResources
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, "trayIconTemplate.png")
    : join(__dirname, "../../build/trayIconTemplate.png");
  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true);
  return icon;
}

interface TrayWindows {
  mainWindow: BrowserWindow | null;
  popoverWindow: BrowserWindow | null;
  togglePopover: () => void;
}

export function createTray({ mainWindow, popoverWindow, togglePopover }: TrayWindows) {
  const icon = loadTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip("koe");

  // Left click: toggle popover
  tray.on("click", () => {
    togglePopover();
  });

  // Right click: context menu
  tray.on("right-click", () => {
    const menu = buildContextMenu(mainWindow, popoverWindow);
    tray?.popUpContextMenu(menu);
  });

  return tray;
}

export function updateTrayState(
  state: RecordingState,
  _mainWindow: BrowserWindow | null,
  _popoverWindow: BrowserWindow | null,
  sourceWindow: BrowserWindow | null,
) {
  currentState = state;
  if (state === "recording") {
    recordingSourceWindow = sourceWindow;
  } else if (state === "idle") {
    recordingSourceWindow = null;
  }
  if (tray) {
    tray.setToolTip(state === "recording" ? "koe - 録音中" : "koe");
  }
}

export function getTray() {
  return tray;
}
