import { useState } from "react";
import { ArrowLeft, History, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { formatDate, formatDuration } from "@koe/shared";
import {
  useDeleteJob,
  useJob,
  useJobTopics,
  useJobs,
  useReanalyzeJob,
} from "~/renderer/hooks/useJobs";
import { StatusBadge } from "./StatusBadge";

export function HistoryView() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (selectedId) {
    return <JobDetailView jobId={selectedId} onBack={() => setSelectedId(null)} />;
  }
  return <JobList onSelect={setSelectedId} />;
}

function JobList({ onSelect }: { onSelect: (id: string) => void }) {
  const { data, isLoading, error } = useJobs();
  const jobs = data?.jobs ?? [];

  return (
    <div className="flex flex-1 flex-col gap-5 p-6">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-text-primary">
          <History size={18} />
          履歴
        </h1>
      </div>

      {isLoading && <p className="text-xs text-text-secondary">読み込み中...</p>}
      {error && <p className="text-xs text-error">{error.message}</p>}

      {!isLoading && jobs.length === 0 && (
        <div className="flex flex-1 items-center justify-center rounded-[12px] border border-[rgba(0,0,0,0.03)] bg-white">
          <p className="text-[13px] text-text-secondary">
            まだ履歴がありません。クイック文字起こしで処理すると、ここに保存されます。
          </p>
        </div>
      )}

      {jobs.length > 0 && (
        <div className="space-y-2">
          {jobs.map((job) => (
            <button
              key={job.id}
              onClick={() => onSelect(job.id)}
              className="flex w-full flex-col gap-1.5 rounded-[10px] border border-[rgba(0,0,0,0.03)] bg-white p-4 text-left hover:border-brand/30"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-[13px] font-semibold text-text-primary">
                  {formatDate(job.created_at)}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  {job.audio_duration_sec != null && (
                    <span className="font-mono text-[11px] text-text-secondary">
                      {formatDuration(job.audio_duration_sec)}
                    </span>
                  )}
                  <StatusBadge status={job.status} />
                </div>
              </div>
              {job.summary && (
                <p className="line-clamp-2 text-xs leading-relaxed text-text-secondary">
                  {job.summary}
                </p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function JobDetailView({ jobId, onBack }: { jobId: string; onBack: () => void }) {
  const jobQuery = useJob(jobId);
  const job = jobQuery.data;
  const topicsQuery = useJobTopics(jobId, job?.status === "completed");
  const deleteJob = useDeleteJob();
  const reanalyzeJob = useReanalyzeJob();
  const [confirming, setConfirming] = useState(false);
  const [confirmingReanalyze, setConfirmingReanalyze] = useState(false);

  if (jobQuery.isLoading) {
    return <p className="p-6 text-xs text-text-secondary">読み込み中...</p>;
  }
  if (jobQuery.error) {
    return <p className="p-6 text-xs text-error">{jobQuery.error.message}</p>;
  }
  if (!job) {
    return <p className="p-6 text-xs text-text-secondary">見つかりませんでした</p>;
  }

  const topics = topicsQuery.data?.topics ?? [];

  const handleConfirmDelete = () => {
    deleteJob.mutate(jobId, {
      onSuccess: () => {
        setConfirming(false);
        onBack();
      },
    });
  };

  return (
    <div className="flex flex-1 flex-col gap-5 p-6">
      <button
        onClick={onBack}
        className="flex w-fit items-center gap-1.5 rounded-[8px] border border-[rgba(0,0,0,0.06)] bg-white px-3 py-1.5 text-[13px] font-medium text-text-primary shadow-sm hover:border-brand/40 hover:text-brand"
      >
        <ArrowLeft size={14} />
        履歴一覧に戻る
      </button>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">{formatDate(job.created_at)}</h1>
          <div className="mt-1.5 flex items-center gap-2">
            <StatusBadge status={job.status} />
            {job.audio_duration_sec != null && (
              <span className="font-mono text-[11px] text-text-secondary">
                {formatDuration(job.audio_duration_sec)}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-[8px] border border-[rgba(0,0,0,0.03)] bg-white px-3 py-1.5 text-xs text-text-secondary hover:border-error/40 hover:text-error"
        >
          <Trash2 size={12} />
          削除
        </button>
      </div>

      {confirming && (
        <DeleteConfirmDialog
          isDeleting={deleteJob.isPending}
          errorMessage={deleteJob.error?.message ?? null}
          onCancel={() => {
            setConfirming(false);
            deleteJob.reset();
          }}
          onConfirm={handleConfirmDelete}
        />
      )}

      {(job.status === "failed" ||
        job.status === "transcribe_failed" ||
        job.status === "analyze_failed") &&
        job.error && (
          <p className="rounded-[8px] bg-error/10 p-3 text-xs text-error">{job.error}</p>
        )}

      {(job.status === "analyze_failed" || job.status === "completed") && (
        <div className="flex flex-col gap-3 rounded-[10px] border border-[rgba(0,0,0,0.03)] bg-white p-4">
          <p className="text-xs leading-relaxed text-text-secondary">
            {job.status === "analyze_failed"
              ? "文字起こし結果は保存されています。要約だけやり直せます（音声の再アップロードは不要です）。"
              : "プロンプトの調整などで要約をやり直したいときは再分析できます。現在の要約とトピックは破棄されます。"}
          </p>
          <button
            type="button"
            onClick={() => {
              if (job.status === "completed") {
                setConfirmingReanalyze(true);
              } else {
                reanalyzeJob.mutate(jobId);
              }
            }}
            disabled={reanalyzeJob.isPending}
            className="flex w-fit items-center gap-1.5 rounded-button bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {reanalyzeJob.isPending ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RotateCcw size={12} />
            )}
            {reanalyzeJob.isPending ? "再分析中..." : "再分析する"}
          </button>
          {reanalyzeJob.isError && (
            <p className="rounded-button bg-error/10 p-2 text-xs text-error">
              {reanalyzeJob.error.message}
            </p>
          )}
        </div>
      )}

      {confirmingReanalyze && (
        <ReanalyzeConfirmDialog
          isPending={reanalyzeJob.isPending}
          errorMessage={reanalyzeJob.error?.message ?? null}
          onCancel={() => {
            setConfirmingReanalyze(false);
            reanalyzeJob.reset();
          }}
          onConfirm={() => {
            reanalyzeJob.mutate(jobId, {
              onSuccess: () => setConfirmingReanalyze(false),
            });
          }}
        />
      )}

      {job.summary && (
        <div className="rounded-[12px] border border-[rgba(0,0,0,0.03)] bg-white p-4">
          <h2 className="text-[13px] font-semibold text-text-primary">サマリー</h2>
          <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-text-primary">
            {job.summary}
          </p>
        </div>
      )}

      {topics.length > 0 && (
        <>
          <h2 className="text-[15px] font-semibold text-text-primary">トピック</h2>
          <div className="space-y-2.5">
            {topics.map((topic) => (
              <div
                key={topic.id}
                className="rounded-[10px] border border-[rgba(0,0,0,0.03)] bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <h4 className="text-[13px] font-semibold text-text-primary">{topic.title}</h4>
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
                  <p className="mt-2 text-xs leading-relaxed text-text-primary">{topic.detail}</p>
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
    </div>
  );
}

function ReanalyzeConfirmDialog({
  isPending,
  errorMessage,
  onCancel,
  onConfirm,
}: {
  isPending: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reanalyze-history-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-[12px] bg-white p-5 shadow-xl"
      >
        <h2 id="reanalyze-history-title" className="text-[15px] font-semibold text-text-primary">
          このジョブを再分析しますか？
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-text-secondary">
          現在の要約とトピックは破棄され、文字起こし結果から再生成します。音声の再アップロードや
          Whisper の再課金は発生しません。
        </p>
        {errorMessage && (
          <p className="mt-3 rounded-button bg-error/10 p-2 text-xs text-error">{errorMessage}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="rounded-button border border-[rgba(0,0,0,0.08)] bg-white px-3 py-1.5 text-xs text-text-primary hover:bg-gray-50 disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="flex items-center gap-1.5 rounded-button bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {isPending && <Loader2 size={12} className="animate-spin" />}
            {isPending ? "再分析中..." : "再分析する"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmDialog({
  isDeleting,
  errorMessage,
  onCancel,
  onConfirm,
}: {
  isDeleting: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-history-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-[12px] bg-white p-5 shadow-xl"
      >
        <h2 id="delete-history-title" className="text-[15px] font-semibold text-text-primary">
          この履歴を削除しますか？
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-text-secondary">
          サーバー上の音声とトピックを削除します。この操作は取り消せません。
        </p>
        {errorMessage && (
          <p className="mt-3 rounded-[8px] bg-error/10 p-2 text-xs text-error">{errorMessage}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="rounded-[8px] border border-[rgba(0,0,0,0.08)] bg-white px-3 py-1.5 text-xs text-text-primary hover:bg-gray-50 disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="rounded-[8px] bg-error px-3 py-1.5 text-xs font-semibold text-white hover:bg-error/90 disabled:opacity-50"
          >
            {isDeleting ? "削除中..." : "削除する"}
          </button>
        </div>
      </div>
    </div>
  );
}
