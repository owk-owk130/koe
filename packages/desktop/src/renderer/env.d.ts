interface ElectronAPI {
  getDesktopSources: () => Promise<{ id: string; name: string; display_id: string }[]>;
  checkPermissions: () => Promise<{ microphone: boolean; screen: boolean }>;
  requestMicPermission: () => Promise<boolean>;
}

interface Window {
  electronAPI: ElectronAPI;
}
