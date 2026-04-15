import type { ElectronAPI } from "../shared/ipc-channels";

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
