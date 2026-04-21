import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { AuthScreen } from "./components/AuthScreen";
import { Sidebar } from "./components/Sidebar";
import { QuickTranscribe } from "./components/QuickTranscribe";
import { HistoryView } from "./components/HistoryView";
import { SettingsPanel } from "./components/SettingsPanel";
import { PopoverView } from "./components/PopoverView";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 2000 },
  },
});

type View = "transcribe" | "history" | "settings";

function AppContent() {
  const { loading, isAuthenticated, user, logout } = useAuth();
  const [view, setView] = useState<View>("transcribe");

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  const userInitial = user?.name?.charAt(0) ?? user?.email?.charAt(0)?.toUpperCase() ?? null;
  const userEmail = user?.email ?? null;

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar
        view={view}
        setView={setView}
        onLogout={logout}
        userInitial={userInitial}
        userEmail={userEmail}
      />

      <main className="flex flex-1 flex-col overflow-auto">
        {view === "settings" ? (
          <SettingsPanel />
        ) : view === "history" ? (
          <HistoryView />
        ) : (
          <QuickTranscribe />
        )}
      </main>
    </div>
  );
}

function PopoverContent() {
  const { loading, isAuthenticated } = useAuth();
  // Run the same auth hydration effect but avoid rendering AuthScreen inside the popover.
  useEffect(() => {}, []);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white/95">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-white/95 p-6 text-center">
        <p className="text-[13px] font-medium text-text-primary">ログインが必要です</p>
        <button
          onClick={() => window.electronAPI.openMainWindow()}
          className="rounded-button bg-text-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
        >
          メインウィンドウを開く
        </button>
      </div>
    );
  }

  return <PopoverView />;
}

const isPopover = new URLSearchParams(window.location.search).get("mode") === "popover";

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{isPopover ? <PopoverContent /> : <AppContent />}</AuthProvider>
    </QueryClientProvider>
  );
}
