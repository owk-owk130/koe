import { app, Menu, Tray, nativeImage, type BrowserWindow } from "electron";
import { join } from "path";
import type { RecordingState } from "~/shared/ipc-channels";
import { IPC } from "~/shared/ipc-channels";

let tray: Tray | null = null;
let currentState: RecordingState = "idle";
let recordingSourceWindow: BrowserWindow | null = null;

// Stop is dispatched to the window that started recording so the MediaRecorder
// in that renderer receives it; start is dispatched to the popover (primary
// quick-access surface). Same IPC channel as the tray menu so the global
// shortcut and tray entry stay in lockstep.
export function toggleRecording(popoverWindow: BrowserWindow | null) {
  const isRecording = currentState === "recording";
  if (isRecording && recordingSourceWindow) {
    recordingSourceWindow.webContents.send(IPC.TRAY_TOGGLE_RECORDING);
  } else {
    popoverWindow?.webContents.send(IPC.TRAY_TOGGLE_RECORDING);
  }
}

function buildContextMenu(mainWindow: BrowserWindow | null, popoverWindow: BrowserWindow | null) {
  const isRecording = currentState === "recording";

  return Menu.buildFromTemplate([
    {
      label: isRecording ? "録音停止" : "録音開始",
      accelerator: "CommandOrControl+Shift+K",
      click: () => toggleRecording(popoverWindow),
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

function resolveIconPath(filename: string): string {
  // In dev, resolve from source build directory; in prod, from extraResources
  return app.isPackaged
    ? join(process.resourcesPath, filename)
    : join(__dirname, "../../build", filename);
}

function loadTrayIcon(state: RecordingState): Electron.NativeImage {
  // Recording icon is a colored (red) PNG: do NOT mark it as a template image
  // or macOS will strip the color and render it monochrome. Idle / processing
  // use the template image so it adapts to light/dark menu bars.
  if (state === "recording") {
    return nativeImage.createFromPath(resolveIconPath("trayIconRecording.png"));
  }
  const icon = nativeImage.createFromPath(resolveIconPath("trayIconTemplate.png"));
  icon.setTemplateImage(true);
  return icon;
}

interface TrayWindows {
  mainWindow: BrowserWindow | null;
  popoverWindow: BrowserWindow | null;
  togglePopover: () => void;
}

export function createTray({ mainWindow, popoverWindow, togglePopover }: TrayWindows) {
  tray = new Tray(loadTrayIcon(currentState));
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
  const prevState = currentState;
  currentState = state;
  if (state === "recording") {
    recordingSourceWindow = sourceWindow;
  } else if (state === "idle") {
    recordingSourceWindow = null;
  }
  if (tray) {
    tray.setToolTip(state === "recording" ? "koe - 録音中" : "koe");
    const wasRecording = prevState === "recording";
    const isRecording = state === "recording";
    if (wasRecording !== isRecording) {
      tray.setImage(loadTrayIcon(state));
    }
  }
}

export function getTray() {
  return tray;
}
