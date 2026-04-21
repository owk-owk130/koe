/// <reference types="vite/client" />
import type { ElectronAPI } from "~/shared/ipc-channels";

interface ImportMetaEnv {
  readonly VITE_KOE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
