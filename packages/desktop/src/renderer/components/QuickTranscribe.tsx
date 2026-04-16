import { formatDuration } from "@koe/shared";
import { RecordingPanel } from "./RecordingPanel";
import { Settings, Upload } from "lucide-react";
import { useLocalTranscribe } from "~/renderer/hooks/useLocalTranscribe";
import { useSidecar } from "~/renderer/hooks/useSidecar";

interface QuickTranscribeProps {
  onNavigateSettings?: () => void;
}

export function QuickTranscribe({ onNavigateSettings }: QuickTranscribeProps) {
  const mutation = useLocalTranscribe();
  const sidecar = useSidecar();

  const result = mutation.data;
  const loading = mutation.isPending;
  const error = mutation.error?.message ?? null;
  const notReady = sidecar.status !== "ready";

  const transcribeBlob = async (blob: Blob) => {
    const filePath = await window.electronAPI.saveRecording(
      await blob.arrayBuffer(),
      `quick-${Date.now()}.webm`,
    );
    mutation.mutate(filePath);
  };

  const transcribeFile = async () => {
    const fileInfo = await window.electronAPI.selectAudioFile();
    if (!fileInfo) return;
    mutation.mutate(fileInfo.path);
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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-primary">クイック文字起こし</h1>
        <button
          onClick={transcribeFile}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-button border border-border px-3 py-1.5 text-xs text-text-primary hover:bg-white disabled:opacity-50"
        >
          <Upload size={12} />
          ファイルから文字起こし
        </button>
      </div>

      <div className="flex flex-1 gap-5">
        {/* Left column - Input */}
        <div className="flex w-1/2 flex-col gap-4">
          <div className="rounded-[12px] border border-[rgba(0,0,0,0.03)] bg-white p-6">
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand/[0.08]">
                <Upload size={20} className="text-brand" />
              </div>
              <p className="text-[13px] text-text-secondary">マイクで録音、またはファイルを選択</p>
              <RecordingPanel onRecordingComplete={transcribeBlob} />
            </div>
          </div>
        </div>

        {/* Right column - Result */}
        <div className="flex w-1/2 flex-col gap-4">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-text-secondary">
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
              文字起こし中...
            </div>
          )}

          {error && <p className="text-xs text-error">{error}</p>}

          {result && (
            <>
              <h2 className="text-[15px] font-semibold text-text-primary">トランスクリプト</h2>
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
                          <span className="font-mono text-[11px] text-text-secondary">
                            {formatDuration(topic.start_sec)} - {formatDuration(topic.end_sec)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                          {topic.summary}
                        </p>
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
    </div>
  );
}
