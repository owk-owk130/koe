import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { AuthUser } from "@koe/shared";

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, token: null, loading: true });

  useEffect(() => {
    async function loadAuth() {
      const token = await window.electronAPI.getToken();
      if (token) {
        const user = await window.electronAPI.getUser();
        setState({ token, user, loading: false });
      } else {
        setState({ token: null, user: null, loading: false });
      }
    }
    loadAuth();
  }, []);

  const login = useCallback(async (token: string) => {
    await window.electronAPI.saveToken(token);
    const user = await window.electronAPI.getUser();
    setState({ token, user, loading: false });
  }, []);

  const logout = useCallback(async () => {
    await window.electronAPI.clearToken();
    setState({ token: null, user: null, loading: false });
  }, []);

  const value: AuthContextValue = {
    ...state,
    login,
    logout,
    isAuthenticated: state.token !== null,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
