import { useEffect, useState } from "react";
import { formatDuration } from "@koe/shared";
import { Mic, Square, RotateCcw, Upload, AppWindow } from "lucide-react";
import { useCreateJob, useJob, useJobTopics } from "~/renderer/hooks/useJobs";
import { useRecording, type AudioSourceMode } from "~/renderer/hooks/useRecording";

export function PopoverView() {
  const createJob = useCreateJob();
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const jobQuery = useJob(currentJobId);
  const job = jobQuery.data;
  const isCompleted = job?.status === "completed";
  const topicsQuery = useJobTopics(currentJobId, isCompleted);

  const { state, duration, audioBlob, audioUrl, error, startRecording, stopRecording, reset } =
    useRecording();
  const [mode, setMode] = useState<AudioSourceMode>("mic");

  useEffect(() => {
    if (createJob.isPending) setCurrentJobId(null);
  }, [createJob.isPending]);

  const uploading = createJob.isPending;
  const processing = job?.status === "pending" || job?.status === "processing";
  const failed = job?.status === "failed";
  const loading = uploading || processing;
  const mutationError =
    createJob.error?.message ??
    jobQuery.error?.message ??
    (failed ? (job?.error ?? "ジョブが失敗しました") : null);

  const transcribeBlob = async (blob: Blob) => {
    const filename = `quick-${Date.now()}.webm`;
    const result = await createJob.mutateAsync({ blob, filename });
    setCurrentJobId(result.id);
  };

  const transcribeFile = async () => {
    const fileInfo = await window.electronAPI.selectAudioFile();
    if (!fileInfo) return;
    const buffer = await window.electronAPI.readFile(fileInfo.path);
    const blob = new Blob([buffer], { type: "audio/mpeg" });
    const result = await createJob.mutateAsync({ blob, filename: fileInfo.name });
    setCurrentJobId(result.id);
  };

  const handleUse = () => {
    if (audioBlob) transcribeBlob(audioBlob);
  };

  const openMainWindow = () => {
    window.electronAPI.openMainWindow();
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-xl bg-white/95 backdrop-blur-xl">
      {/* Drag handle + header */}
      <div className="flex shrink-0 items-center justify-between px-4 pt-3 pb-2">
        <h1 className="text-[13px] font-semibold text-text-primary">koe</h1>
        <button
          onClick={openMainWindow}
          className="flex items-center gap-1 rounded-button px-2 py-1 text-[11px] text-text-secondary hover:bg-surface"
          title="メインウィンドウを開く"
        >
          <AppWindow size={12} />
        </button>
      </div>

      {/* Recording controls */}
      <div className="shrink-0 border-b border-[rgba(0,0,0,0.06)] px-4 pb-3">
        {/* Audio source selector */}
        {state === "idle" && !audioUrl && (
          <div className="mb-2 flex gap-1">
            {(["mic", "system", "both"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 rounded-button px-2 py-1 text-[11px] font-medium ${
                  mode === m
                    ? "bg-text-primary text-white"
                    : "border border-border text-text-primary hover:bg-surface"
                }`}
              >
                {m === "mic" ? "マイク" : m === "system" ? "システム" : "両方"}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          {state === "idle" && !audioUrl && (
            <>
              <button
                onClick={() => startRecording(mode)}
                disabled={loading}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-button bg-brand px-3 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                <Mic size={14} />
                録音
              </button>
              <button
                onClick={transcribeFile}
                disabled={loading}
                className="flex items-center gap-1.5 rounded-button border border-border px-3 py-2 text-xs text-text-primary hover:bg-surface disabled:opacity-50"
              >
                <Upload size={12} />
                ファイル
              </button>
            </>
          )}

          {state === "recording" && (
            <>
              <span className="flex-1 text-center font-mono text-sm font-semibold text-brand">
                ● {formatDuration(duration)}
              </span>
              <button
                onClick={stopRecording}
                className="flex items-center gap-1.5 rounded-button bg-text-primary px-4 py-2 text-xs font-medium text-white hover:opacity-90"
              >
                <Square size={14} />
                停止
              </button>
            </>
          )}

          {audioUrl && (
            <div className="flex w-full flex-col gap-2">
              <audio src={audioUrl} controls className="h-8 w-full" />
              <div className="flex gap-2">
                <button
                  onClick={handleUse}
                  disabled={loading}
                  className="flex-1 rounded-button bg-text-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  文字起こし
                </button>
                <button
                  onClick={reset}
                  className="flex items-center gap-1 rounded-button border border-border px-3 py-1.5 text-xs text-text-primary hover:bg-surface"
                >
                  <RotateCcw size={12} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Result area */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading && (
          <div className="flex flex-col items-center justify-center gap-2 py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-[3px] border-brand border-t-transparent" />
            <p className="text-xs text-text-secondary">
              {uploading ? "アップロード中..." : "文字起こし中..."}
            </p>
          </div>
        )}

        {(mutationError || error) && <p className="text-xs text-error">{mutationError || error}</p>}

        {isCompleted && job && (
          <div className="space-y-3">
            {job.summary && (
              <div>
                <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-text-secondary uppercase">
                  概要
                </h3>
                <p className="text-[12px] leading-relaxed text-text-primary">{job.summary}</p>
              </div>
            )}

            {topicsQuery.data && topicsQuery.data.topics.length > 0 && (
              <div>
                <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-text-secondary uppercase">
                  トピック
                </h3>
                <div className="space-y-1.5">
                  {topicsQuery.data.topics.map((topic) => (
                    <div key={topic.id} className="rounded-lg bg-surface p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-[12px] font-semibold text-text-primary">
                          {topic.title}
                        </h4>
                        {topic.start_sec !== null && (
                          <span className="shrink-0 font-mono text-[10px] text-text-secondary">
                            {formatDuration(topic.start_sec)}
                          </span>
                        )}
                      </div>
                      {topic.summary && (
                        <p className="mt-0.5 text-[11px] leading-relaxed text-text-secondary">
                          {topic.summary}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!loading && !mutationError && !error && !isCompleted && (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <Mic size={20} className="text-text-secondary/40" />
            <p className="text-[12px] text-text-secondary">
              録音またはファイルで
              <br />
              文字起こしを開始
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
