import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { AppSettings, ApiKeysInput, ApiKeysOutput } from "~/shared/ipc-channels";

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

  const saveSettingsMutation = useMutation({
    mutationFn: (settings: AppSettings) => window.electronAPI.saveSettings(settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const saveApiKeysMutation = useMutation({
    mutationFn: (keys: ApiKeysInput) => window.electronAPI.saveApiKeys(keys),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["apiKeys"] });
      queryClient.invalidateQueries({ queryKey: ["isConfigured"] });
    },
  });

  return {
    settings: settingsQuery.data as AppSettings | undefined,
    apiKeys: apiKeysQuery.data as ApiKeysOutput | undefined,
    isConfigured: configuredQuery.data ?? false,
    loading: settingsQuery.isLoading || apiKeysQuery.isLoading,
    saveSettings: saveSettingsMutation.mutate,
    saveApiKeys: saveApiKeysMutation.mutate,
    isSaving: saveSettingsMutation.isPending || saveApiKeysMutation.isPending,
  };
}
