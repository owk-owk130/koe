import { useEffect, useState } from "react";
import { formatDuration } from "@koe/shared";
import { RecordingPanel } from "./RecordingPanel";
import { useCreateJob, useJob, useJobTopics } from "~/renderer/hooks/useJobs";

export function QuickTranscribe() {
  const createJob = useCreateJob();
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);

  const jobQuery = useJob(currentJobId);
  const job = jobQuery.data;
  const isCompleted = job?.status === "completed";
  const topicsQuery = useJobTopics(currentJobId, isCompleted);

  // Reset current job if creation is retried
  useEffect(() => {
    if (createJob.isPending) setCurrentJobId(null);
  }, [createJob.isPending]);

  const uploading = createJob.isPending;
  const processing =
    job?.status === "pending" ||
    job?.status === "processing" ||
    job?.status === "transcribing" ||
    job?.status === "analyzing";
  const failed =
    job?.status === "failed" ||
    job?.status === "transcribe_failed" ||
    job?.status === "analyze_failed";
  const loading = uploading || processing;
  const progressLabel = uploading
    ? "アップロード中..."
    : job?.status === "analyzing"
      ? "要約中..."
      : job?.status === "transcribing" || job?.status === "processing"
        ? "文字起こし中..."
        : "処理を準備中...";

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

  const error = createJob.error?.message ?? jobQuery.error?.message ?? job?.error ?? null;

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
          transcribing={loading || isCompleted}
        />
      </div>

      {/* Bottom - Result */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        {loading && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-[12px] border border-[rgba(0,0,0,0.03)] bg-white">
            <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-brand border-t-transparent" />
            <p className="text-[13px] font-medium text-text-primary">{progressLabel}</p>
          </div>
        )}

        {error && <p className="text-xs text-error">{error}</p>}
        {failed && !error && (
          <p className="text-xs text-error">ジョブが失敗しました。もう一度お試しください。</p>
        )}

        {isCompleted && job && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-text-primary">トランスクリプト</h2>
              <p className="text-xs text-text-secondary">履歴に保存しました</p>
            </div>

            {job.summary && (
              <>
                <h2 className="text-[15px] font-semibold text-text-primary">概要</h2>
                <div className="rounded-[12px] border border-[rgba(0,0,0,0.03)] bg-[#f8f8f8] p-4">
                  <p className="text-[13px] leading-relaxed text-text-secondary">{job.summary}</p>
                </div>
              </>
            )}

            {topicsQuery.data && topicsQuery.data.topics.length > 0 && (
              <>
                <h2 className="text-[15px] font-semibold text-text-primary">トピック</h2>
                <div className="space-y-2.5">
                  {topicsQuery.data.topics.map((topic) => (
                    <div
                      key={topic.id}
                      className="rounded-[10px] border border-[rgba(0,0,0,0.03)] bg-white p-4"
                    >
                      <div className="flex items-start justify-between">
                        <h4 className="text-[13px] font-semibold text-text-primary">
                          {topic.title}
                        </h4>
                        {topic.start_sec !== null && topic.end_sec !== null && (
                          <span className="shrink-0 font-mono text-[11px] text-text-secondary">
                            {formatDuration(topic.start_sec)} - {formatDuration(topic.end_sec)}
                          </span>
                        )}
                      </div>
                      {topic.summary && (
                        <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                          {topic.summary}
                        </p>
                      )}
                      {topic.detail && (
                        <p className="mt-2 text-xs leading-relaxed text-text-primary">
                          {topic.detail}
                        </p>
                      )}
                      {topic.transcript && (
                        <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-text-primary">
                          {topic.transcript}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {!loading && !error && !isCompleted && !failed && (
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
