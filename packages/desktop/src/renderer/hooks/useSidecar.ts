import { useEffect, useState } from "react";
import type { SidecarState } from "~/shared/ipc-channels";

export function useSidecar() {
  const [state, setState] = useState<SidecarState>({ status: "stopped" });

  useEffect(() => {
    window.electronAPI.getSidecarStatus().then(setState);
    const unsubscribe = window.electronAPI.onSidecarStatusChanged(setState);
    return unsubscribe;
  }, []);

  return state;
}
