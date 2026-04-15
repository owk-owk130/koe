import { useState } from "react";
import { Mic } from "lucide-react";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { AuthScreen } from "./components/AuthScreen";
import { Dashboard } from "./components/Dashboard";
import { QuickTranscribe } from "./components/QuickTranscribe";

type View = "dashboard" | "transcribe";

function NavBar({
  view,
  setView,
  isAuthenticated,
  userInitial,
}: {
  view: View;
  setView: (v: View) => void;
  isAuthenticated: boolean;
  userInitial: string | null;
}) {
  return (
    <header className="flex h-11 items-center justify-between border-b border-b-[rgba(0,0,0,0.02)] bg-white px-4">
      <div className="flex items-center gap-2">
        <Mic size={18} className="text-brand" />
        <span className="text-base font-semibold text-text-primary">koe</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setView("transcribe")}
          className={`rounded-button px-2.5 py-1 text-xs font-medium ${
            view === "transcribe"
              ? "bg-text-primary text-white"
              : "text-text-secondary hover:bg-surface"
          }`}
        >
          クイック文字起こし
        </button>
        {isAuthenticated && (
          <>
            <button
              onClick={() => setView("dashboard")}
              className={`rounded-button px-2.5 py-1 text-xs font-medium ${
                view === "dashboard"
                  ? "bg-text-primary text-white"
                  : "text-text-secondary hover:bg-surface"
              }`}
            >
              ダッシュボード
            </button>
            {userInitial && (
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-surface text-xs font-semibold text-text-primary">
                {userInitial}
              </div>
            )}
          </>
        )}
      </div>
    </header>
  );
}

function AppContent() {
  const { loading, isAuthenticated, user } = useAuth();
  const [view, setView] = useState<View>("dashboard");

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated && view === "dashboard") {
    return (
      <div className="flex min-h-screen flex-col bg-white">
        <NavBar view={view} setView={setView} isAuthenticated={false} userInitial={null} />
        <AuthScreen />
      </div>
    );
  }

  const userInitial = user?.name?.charAt(0) ?? user?.email?.charAt(0)?.toUpperCase() ?? null;

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <NavBar
        view={view}
        setView={setView}
        isAuthenticated={isAuthenticated}
        userInitial={userInitial}
      />
      <main className="flex-1 overflow-auto">
        {view === "transcribe" ? <QuickTranscribe /> : <Dashboard />}
      </main>
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
