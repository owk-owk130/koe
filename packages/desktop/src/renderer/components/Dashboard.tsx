import { useCallback, useState } from "react";
import { LogOut, Plus, Upload } from "lucide-react";
import { createApiClient } from "@koe/shared";
import { useAuth } from "../hooks/useAuth";
import { useJobs } from "../hooks/useJobs";
import { RecordingPanel } from "./RecordingPanel";
import { JobList } from "./JobList";
import { JobDetail } from "./JobDetail";

const API_URL = "http://localhost:8787";

export function Dashboard() {
  const { token, logout } = useAuth();
  const { jobs, refresh } = useJobs();
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showRecording, setShowRecording] = useState(false);

  const api = createApiClient(API_URL);

  const handleRecordingComplete = useCallback(
    async (blob: Blob) => {
      if (!token) return;
      setUploading(true);
      try {
        const file = new File([blob], `recording-${Date.now()}.webm`, { type: "audio/webm" });
        const result = await api.createJob(token, file);
        setSelectedJobId(result.id);
        setShowRecording(false);
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
    return <JobDetail jobId={selectedJobId} onBack={() => setSelectedJobId(null)} />;
  }

  return (
    <div className="space-y-4 p-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-primary">ジョブ一覧</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRecording(!showRecording)}
            className="flex items-center gap-1.5 rounded-button bg-text-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            <Plus size={12} />
            新規ジョブ
          </button>
          <button
            onClick={handleFileImport}
            disabled={uploading}
            className="flex items-center gap-1.5 rounded-button border border-border px-3 py-1.5 text-xs text-text-primary hover:bg-surface disabled:opacity-50"
          >
            <Upload size={12} />
            ファイル
          </button>
          <button
            onClick={logout}
            className="flex items-center gap-1 rounded-button px-2 py-1.5 text-xs text-text-secondary hover:bg-surface"
          >
            <LogOut size={12} />
          </button>
        </div>
      </div>

      {showRecording && (
        <div className="rounded-card bg-white p-4 shadow-card">
          <RecordingPanel onRecordingComplete={handleRecordingComplete} />
          {uploading && <p className="mt-2 text-[11px] text-text-secondary">アップロード中...</p>}
        </div>
      )}

      <JobList jobs={jobs} onSelect={setSelectedJobId} />
    </div>
  );
}
