import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { AppSettings, ApiKeysOutput, SaveAllPayload } from "~/shared/ipc-channels";

export function useSettings() {
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => window.electronAPI.getSettings(),
  });

  const apiKeysQuery = useQuery({
    queryKey: ["apiKeys"],
    queryFn: () => window.electronAPI.getApiKeys(),
  });

  const configuredQuery = useQuery({
    queryKey: ["isConfigured"],
    queryFn: () => window.electronAPI.isConfigured(),
  });

  const saveAllMutation = useMutation({
    mutationFn: (payload: SaveAllPayload) => window.electronAPI.saveAll(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      queryClient.invalidateQueries({ queryKey: ["apiKeys"] });
      queryClient.invalidateQueries({ queryKey: ["isConfigured"] });
    },
  });

  return {
    settings: settingsQuery.data as AppSettings | undefined,
    apiKeys: apiKeysQuery.data as ApiKeysOutput | undefined,
    isConfigured: configuredQuery.data ?? false,
    loading: settingsQuery.isLoading || apiKeysQuery.isLoading,
    saveAll: saveAllMutation.mutateAsync,
    isSaving: saveAllMutation.isPending,
    saveError: saveAllMutation.error,
  };
}
