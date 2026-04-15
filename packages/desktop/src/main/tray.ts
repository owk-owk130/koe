import { Menu, Tray, nativeImage, type BrowserWindow } from "electron";
import type { RecordingState } from "~/shared/ipc-channels";
import { IPC } from "~/shared/ipc-channels";

let tray: Tray | null = null;
let currentState: RecordingState = "idle";

function buildMenu(mainWindow: BrowserWindow | null) {
  const isRecording = currentState === "recording";

  return Menu.buildFromTemplate([
    {
      label: isRecording ? "録音停止" : "録音開始",
      click: () => {
        mainWindow?.webContents.send(IPC.TRAY_TOGGLE_RECORDING);
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
        const { app } = require("electron");
        (app as typeof app & { isQuitting: boolean }).isQuitting = true;
        app.quit();
      },
    },
  ]);
}

export function createTray(mainWindow: BrowserWindow | null) {
  // Create a small 16x16 tray icon
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("koe");
  tray.setContextMenu(buildMenu(mainWindow));

  tray.on("click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  return tray;
}

export function updateTrayState(state: RecordingState, mainWindow: BrowserWindow | null) {
  currentState = state;
  if (tray) {
    tray.setContextMenu(buildMenu(mainWindow));
    tray.setToolTip(state === "recording" ? "koe - 録音中" : "koe");
  }
}
