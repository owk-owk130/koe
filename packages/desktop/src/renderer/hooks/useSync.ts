import { useMutation } from "@tanstack/react-query";
import { useAuth } from "./useAuth";
import type { LocalProcessResult } from "~/shared/ipc-channels";

const API_URL = "http://localhost:8787";

interface SyncInput {
  audioFilename: string;
  result: LocalProcessResult;
}

export function useSync() {
  const { token, isAuthenticated } = useAuth();

  const mutation = useMutation({
    mutationFn: async ({ audioFilename, result }: SyncInput) => {
      const res = await fetch(`${API_URL}/api/v1/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          audio_filename: audioFilename,
          transcript: result.transcript,
          summary: result.summary,
          topics: result.topics,
          chunks: result.chunks,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          (body as { error?: { message?: string } })?.error?.message ??
            `Sync failed (${res.status})`,
        );
      }

      return res.json();
    },
  });

  return {
    sync: mutation.mutate,
    isSyncing: mutation.isPending,
    syncError: mutation.error,
    canSync: isAuthenticated,
  };
}
