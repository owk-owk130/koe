import { useState } from "react";
import { formatDuration } from "@koe/shared";
import { RecordingPanel } from "./RecordingPanel";
import { Cloud, Settings } from "lucide-react";
import { useLocalTranscribe } from "~/renderer/hooks/useLocalTranscribe";
import { useSidecar } from "~/renderer/hooks/useSidecar";
import { useSync } from "~/renderer/hooks/useSync";

interface QuickTranscribeProps {
  onNavigateSettings?: () => void;
}

export function QuickTranscribe({ onNavigateSettings }: QuickTranscribeProps) {
  const mutation = useLocalTranscribe();
  const sidecar = useSidecar();
  const { sync, isSyncing, canSync } = useSync();
  const [synced, setSynced] = useState(false);
  const [audioFilename, setAudioFilename] = useState("");

  const result = mutation.data;
  const loading = mutation.isPending;
  const error = mutation.error?.message ?? null;
  const notReady = sidecar.status !== "ready";

  const transcribeBlob = async (blob: Blob) => {
    const filename = `quick-${Date.now()}.webm`;
    const filePath = await window.electronAPI.saveRecording(await blob.arrayBuffer(), filename);
    setAudioFilename(filename);
    setSynced(false);
    mutation.mutate(filePath);
  };

  const transcribeFile = async () => {
    const fileInfo = await window.electronAPI.selectAudioFile();
    if (!fileInfo) return;
    setAudioFilename(fileInfo.name);
    setSynced(false);
    mutation.mutate(fileInfo.path);
  };

  const handleSync = () => {
    if (!result) return;
    sync(
      { audioFilename, result },
      {
        onSuccess: () => setSynced(true),
      },
    );
  };

  if (notReady) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface">
          <Settings size={24} className="text-text-secondary" />
        </div>
        <p className="text-[15px] font-semibold text-text-primary">APIキーの設定が必要です</p>
        <p className="text-center text-[13px] leading-relaxed text-text-secondary">
          文字起こしを使うには、設定画面で
          <br />
          Whisper APIキーを入力してください
        </p>
        {onNavigateSettings && (
          <button
            onClick={onNavigateSettings}
            className="flex items-center gap-1.5 rounded-button bg-text-primary px-4 py-2 text-xs font-medium text-white hover:opacity-90"
          >
            <Settings size={13} />
            設定を開く
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-5 p-6">
      {/* Toolbar */}
      <h1 className="text-xl font-semibold text-text-primary">クイック文字起こし</h1>

      {/* Top - Operation */}
      <div className="shrink-0 rounded-[12px] border border-[rgba(0,0,0,0.03)] bg-white px-5 py-4">
        <RecordingPanel
          onRecordingComplete={transcribeBlob}
          onFileSelect={transcribeFile}
          fileSelectDisabled={loading}
          transcribing={loading || !!result}
        />
      </div>

      {/* Bottom - Result */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
            文字起こし中...
          </div>
        )}

        {error && <p className="text-xs text-error">{error}</p>}

        {result && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-text-primary">トランスクリプト</h2>
              {!synced && canSync && (
                <button
                  onClick={handleSync}
                  disabled={isSyncing}
                  className="flex items-center gap-1.5 rounded-button border border-border px-3 py-1.5 text-xs text-text-primary hover:bg-white disabled:opacity-50"
                >
                  <Cloud size={12} />
                  {isSyncing ? "同期中..." : "クラウドに保存"}
                </button>
              )}
              {synced && <p className="text-xs text-success">クラウドに保存しました</p>}
            </div>
            <div className="rounded-[12px] border border-[rgba(0,0,0,0.03)] bg-white p-4">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-text-primary">
                {result.transcript.text}
              </p>
            </div>

            {result.topics.length > 0 && (
              <>
                <h2 className="text-[15px] font-semibold text-text-primary">トピック</h2>
                <div className="space-y-2.5">
                  {result.topics.map((topic, i) => (
                    <div
                      key={i}
                      className="rounded-[10px] border border-[rgba(0,0,0,0.03)] bg-white p-4"
                    >
                      <div className="flex items-start justify-between">
                        <h4 className="text-[13px] font-semibold text-text-primary">
                          {topic.title}
                        </h4>
                        <span className="shrink-0 font-mono text-[11px] text-text-secondary">
                          {formatDuration(topic.start_sec)} - {formatDuration(topic.end_sec)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                        {topic.summary}
                      </p>
                      {topic.detail && (
                        <p className="mt-2 text-xs leading-relaxed text-text-primary">
                          {topic.detail}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {!loading && !error && !result && (
          <div className="flex flex-1 items-center justify-center rounded-[12px] border border-[rgba(0,0,0,0.03)] bg-white">
            <p className="text-[13px] text-text-secondary">
              録音またはファイルを選択して文字起こしを開始
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
