import { useMutation } from "@tanstack/react-query";
import type { LocalProcessResult } from "~/shared/ipc-channels";

export function useLocalTranscribe() {
  return useMutation({
    mutationFn: async (audioFilePath: string): Promise<LocalProcessResult> => {
      return window.electronAPI.processLocal(audioFilePath);
    },
  });
}
