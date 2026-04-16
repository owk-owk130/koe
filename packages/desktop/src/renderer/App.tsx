import { useState } from "react";
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { Plus, Upload } from "lucide-react";
import { parseResponse } from "@koe/shared";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { useJobs, useInvalidateJobs } from "./hooks/useJobs";
import { useApiClient } from "./hooks/useApiClient";
import { AuthScreen } from "./components/AuthScreen";
import { Sidebar } from "./components/Sidebar";
import { QuickTranscribe } from "./components/QuickTranscribe";
import { JobDetail } from "./components/JobDetail";
import { RecordingPanel } from "./components/RecordingPanel";
import { SettingsPanel } from "./components/SettingsPanel";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 2000 },
  },
});

type View = "transcribe" | "jobs" | "settings";

function JobsEmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3">
      <div className="text-text-secondary/40">
        <svg
          width={40}
          height={40}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path d="M22 12H16L14 15H10L8 12H2" />
          <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
        </svg>
      </div>
      <p className="text-[15px] font-semibold text-text-primary">まだジョブがありません</p>
      <p className="text-center text-[13px] leading-relaxed text-text-secondary">
        音声ファイルをアップロードするか、
        <br />
        録音して文字起こしを開始しましょう
      </p>
    </div>
  );
}

function AppContent() {
  const { loading, isAuthenticated, user, logout } = useAuth();
  const { jobs } = useJobs();
  const invalidateJobs = useInvalidateJobs();
  const [view, setView] = useState<View>("transcribe");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [showRecording, setShowRecording] = useState(false);

  const client = useApiClient();

  const createJobMutation = useMutation({
    mutationFn: (file: File) => parseResponse(client.api.v1.jobs.$post({ form: { audio: file } })),
    onSuccess: (result) => {
      invalidateJobs();
      setSelectedJobId(result.id);
      setShowRecording(false);
      setView("jobs");
    },
  });

  const handleRecordingComplete = (blob: Blob) => {
    const file = new File([blob], `recording-${Date.now()}.webm`, { type: "audio/webm" });
    createJobMutation.mutate(file);
  };

  const handleFileImport = async () => {
    const fileInfo = await window.electronAPI.selectAudioFile();
    if (!fileInfo) return;

    const buffer = await window.electronAPI.readFile(fileInfo.path);
    const file = new File([buffer], fileInfo.name, { type: "audio/mpeg" });
    createJobMutation.mutate(file);
  };

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
  const uploading = createJobMutation.isPending;

  const renderJobsContent = () => {
    if (selectedJobId) {
      return <JobDetail jobId={selectedJobId} />;
    }

    return (
      <>
        {showRecording && (
          <div className="rounded-[12px] border border-[rgba(0,0,0,0.03)] bg-white p-4">
            <RecordingPanel onRecordingComplete={handleRecordingComplete} />
            {uploading && <p className="mt-2 text-[11px] text-text-secondary">アップロード中...</p>}
          </div>
        )}

        {jobs.length === 0 ? (
          <JobsEmptyState />
        ) : (
          <p className="text-xs text-text-secondary">サイドバーからジョブを選択してください</p>
        )}
      </>
    );
  };

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar
        view={view}
        setView={setView}
        jobs={jobs}
        selectedJobId={selectedJobId}
        onSelectJob={setSelectedJobId}
        onLogout={logout}
        onNewJob={() => {
          setShowRecording(true);
          setSelectedJobId(null);
          setView("jobs");
        }}
        userInitial={userInitial}
        userEmail={userEmail}
        isAuthenticated={isAuthenticated}
      />

      <main className="flex flex-1 flex-col overflow-auto">
        {view === "settings" ? (
          <SettingsPanel />
        ) : view === "transcribe" ? (
          <QuickTranscribe onNavigateSettings={() => setView("settings")} />
        ) : !isAuthenticated ? (
          <AuthScreen />
        ) : (
          <div className="flex flex-1 flex-col gap-5 p-6">
            {/* Toolbar */}
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-semibold text-text-primary">
                {selectedJobId ? "" : "ジョブ一覧"}
              </h1>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setShowRecording(!showRecording);
                    setSelectedJobId(null);
                  }}
                  className="flex items-center gap-1.5 rounded-button bg-text-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                >
                  <Plus size={12} />
                  新規ジョブ
                </button>
                <button
                  onClick={handleFileImport}
                  disabled={uploading}
                  className="flex items-center gap-1.5 rounded-button border border-border px-3 py-1.5 text-xs text-text-primary hover:bg-white disabled:opacity-50"
                >
                  <Upload size={12} />
                  ファイル
                </button>
              </div>
            </div>

            {renderJobsContent()}
          </div>
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
