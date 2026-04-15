import { useMemo } from "react";
import { createClient } from "@koe/shared";
import { useAuth } from "./useAuth";

const API_URL = "http://localhost:8787";

export function useApiClient() {
  const { token } = useAuth();
  return useMemo(
    () => createClient(API_URL, { getToken: () => token }),
    [token],
  );
}
