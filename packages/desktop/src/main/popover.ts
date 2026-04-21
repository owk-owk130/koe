import { BrowserWindow, screen } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { getTray } from "./tray";

const POPOVER_WIDTH = 380;
const POPOVER_HEIGHT = 520;

let popoverWindow: BrowserWindow | null = null;

export function createPopoverWindow(): BrowserWindow {
  popoverWindow = new BrowserWindow({
    width: POPOVER_WIDTH,
    height: POPOVER_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    skipTaskbar: true,
    transparent: true,
    vibrancy: "popover",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    popoverWindow.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}?mode=popover`);
  } else {
    popoverWindow.loadFile(join(__dirname, "../renderer/index.html"), {
      query: { mode: "popover" },
    });
  }

  popoverWindow.on("blur", () => {
    popoverWindow?.hide();
  });

  popoverWindow.on("closed", () => {
    popoverWindow = null;
  });

  return popoverWindow;
}

export function togglePopover() {
  if (!popoverWindow) return;

  if (popoverWindow.isVisible()) {
    popoverWindow.hide();
    return;
  }

  positionPopover();
  popoverWindow.show();
}

function positionPopover() {
  if (!popoverWindow) return;

  const tray = getTray();
  if (!tray) return;

  const trayBounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: trayBounds.x,
    y: trayBounds.y,
  });

  const x = Math.round(trayBounds.x + trayBounds.width / 2 - POPOVER_WIDTH / 2);
  const y = trayBounds.y + trayBounds.height + 4;

  // Clamp to screen bounds
  const clampedX = Math.max(
    display.workArea.x,
    Math.min(x, display.workArea.x + display.workArea.width - POPOVER_WIDTH),
  );

  popoverWindow.setPosition(clampedX, y);
}

export function getPopoverWindow() {
  return popoverWindow;
}
