import { useState } from "react";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { AuthScreen } from "./components/AuthScreen";
import { Dashboard } from "./components/Dashboard";
import { QuickTranscribe } from "./components/QuickTranscribe";

type View = "dashboard" | "transcribe";

function AppContent() {
  const { loading, isAuthenticated } = useAuth();
  const [view, setView] = useState<View>("dashboard");

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  // Quick transcribe is available without auth
  if (view === "transcribe") {
    return (
      <div className="p-6">
        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setView("dashboard")}
            className="rounded-lg px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200"
          >
            ダッシュボード
          </button>
          <button className="rounded-lg px-3 py-1.5 text-sm bg-blue-600 text-white">
            クイック文字起こし
          </button>
        </div>
        <QuickTranscribe />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div>
        <div className="flex justify-center pt-4">
          <button
            onClick={() => setView("transcribe")}
            className="text-sm text-blue-600 hover:underline"
          >
            ログインせずにクイック文字起こし
          </button>
        </div>
        <AuthScreen />
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-2 px-6 pt-4">
        <button className="rounded-lg px-3 py-1.5 text-sm bg-blue-600 text-white">
          ダッシュボード
        </button>
        <button
          onClick={() => setView("transcribe")}
          className="rounded-lg px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200"
        >
          クイック文字起こし
        </button>
      </div>
      <Dashboard />
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-gray-50 text-gray-900">
        <AppContent />
      </div>
    </AuthProvider>
  );
}
