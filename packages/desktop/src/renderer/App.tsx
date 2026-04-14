import { AuthProvider, useAuth } from "./hooks/useAuth";
import { AuthScreen } from "./components/AuthScreen";
import { Dashboard } from "./components/Dashboard";

function AppContent() {
  const { loading, isAuthenticated } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  return <Dashboard />;
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
