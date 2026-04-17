import { useMutation } from "@tanstack/react-query";
import type { LocalProcessResult } from "~/shared/ipc-channels";
import { useInvalidateLocalHistory } from "./useLocalHistory";

export function useLocalTranscribe() {
  const invalidateHistory = useInvalidateLocalHistory();

  return useMutation({
    mutationFn: async (audioFilePath: string): Promise<LocalProcessResult> => {
      return window.electronAPI.processLocal(audioFilePath);
    },
    onSuccess: () => {
      invalidateHistory();
    },
  });
}
