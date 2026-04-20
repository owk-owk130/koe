import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { AuthScreen } from "./components/AuthScreen";
import { Sidebar } from "./components/Sidebar";
import { QuickTranscribe } from "./components/QuickTranscribe";
import { LocalHistoryView } from "./components/LocalHistoryView";
import { SettingsPanel } from "./components/SettingsPanel";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 2000 },
  },
});

type View = "transcribe" | "history" | "settings" | "auth";

function AppContent() {
  const { loading, isAuthenticated, user, logout } = useAuth();
  const [view, setView] = useState<View>("transcribe");

  useEffect(() => {
    if (view === "auth" && isAuthenticated) {
      setView("history");
    }
  }, [view, isAuthenticated]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    );
  }

  const userInitial = isAuthenticated
    ? (user?.name?.charAt(0) ?? user?.email?.charAt(0)?.toUpperCase() ?? null)
    : null;
  const userEmail = isAuthenticated ? (user?.email ?? null) : null;

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar
        view={view}
        setView={setView}
        onLogout={logout}
        userInitial={userInitial}
        userEmail={userEmail}
        isAuthenticated={isAuthenticated}
      />

      <main className="flex flex-1 flex-col overflow-auto">
        {view === "settings" ? (
          <SettingsPanel />
        ) : view === "history" ? (
          <LocalHistoryView />
        ) : view === "auth" ? (
          <AuthScreen />
        ) : (
          <QuickTranscribe onNavigateSettings={() => setView("settings")} />
        )}
      </main>
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </QueryClientProvider>
  );
}
