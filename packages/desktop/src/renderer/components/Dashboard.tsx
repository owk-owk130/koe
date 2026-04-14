import { useCallback, useState } from "react";
import { LogOut, Upload } from "lucide-react";
import { createApiClient } from "@koe/shared";
import { useAuth } from "../hooks/useAuth";
import { useJobs } from "../hooks/useJobs";
import { RecordingPanel } from "./RecordingPanel";
import { JobList } from "./JobList";
import { JobDetail } from "./JobDetail";

const API_URL = "http://localhost:8787";

export function Dashboard() {
  const { user, token, logout } = useAuth();
  const { jobs, refresh } = useJobs();
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const api = createApiClient(API_URL);

  const handleRecordingComplete = useCallback(
    async (blob: Blob) => {
      if (!token) return;
      setUploading(true);
      try {
        const file = new File([blob], `recording-${Date.now()}.webm`, { type: "audio/webm" });
        const result = await api.createJob(token, file);
        setSelectedJobId(result.id);
        refresh();
      } catch (e) {
        console.error("Upload failed:", e);
      } finally {
        setUploading(false);
      }
    },
    [token, api, refresh],
  );

  const handleFileImport = useCallback(async () => {
    if (!token) return;
    const fileInfo = await window.electronAPI.selectAudioFile();
    if (!fileInfo) return;

    setUploading(true);
    try {
      const buffer = await window.electronAPI.readFile(fileInfo.path);
      const file = new File([buffer], fileInfo.name, { type: "audio/mpeg" });
      const result = await api.createJob(token, file);
      setSelectedJobId(result.id);
      refresh();
    } catch (e) {
      console.error("File import failed:", e);
    } finally {
      setUploading(false);
    }
  }, [token, api, refresh]);

  if (selectedJobId) {
    return (
      <div className="p-6">
        <JobDetail jobId={selectedJobId} onBack={() => setSelectedJobId(null)} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">koe</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">{user?.email}</span>
          <button
            onClick={logout}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
          >
            <LogOut size={14} />
            ログアウト
          </button>
        </div>
      </div>

      {/* Recording */}
      <section>
        <h2 className="mb-3 font-semibold">録音</h2>
        <RecordingPanel onRecordingComplete={handleRecordingComplete} />
      </section>

      {/* File import */}
      <section>
        <button
          onClick={handleFileImport}
          disabled={uploading}
          className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          <Upload size={16} />
          ファイルをインポート
        </button>
        {uploading && <p className="mt-1 text-xs text-gray-500">アップロード中...</p>}
      </section>

      {/* Job list */}
      <section>
        <h2 className="mb-3 font-semibold">ジョブ一覧</h2>
        <JobList jobs={jobs} onSelect={setSelectedJobId} />
      </section>
    </div>
  );
}
