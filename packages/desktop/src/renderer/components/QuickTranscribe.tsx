import { useMutation } from "@tanstack/react-query";
import { parseResponse, formatDuration } from "@koe/shared";
import { RecordingPanel } from "./RecordingPanel";
import { Upload } from "lucide-react";
import { useApiClient } from "../hooks/useApiClient";

export function QuickTranscribe() {
  const client = useApiClient();
  const mutation = useMutation({
    mutationFn: (file: File) =>
      parseResponse(client.api.v1.transcribe.$post({ form: { audio: file } })),
  });

  const result = mutation.data;
  const loading = mutation.isPending;
  const error = mutation.error?.message ?? null;

  const transcribeBlob = (blob: Blob) => {
    const file = new File([blob], `quick-${Date.now()}.webm`, { type: "audio/webm" });
    mutation.mutate(file);
  };

  const transcribeFile = async () => {
    const fileInfo = await window.electronAPI.selectAudioFile();
    if (!fileInfo) return;

    const buffer = await window.electronAPI.readFile(fileInfo.path);
    const file = new File([buffer], fileInfo.name, { type: "audio/mpeg" });
    mutation.mutate(file);
  };

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
