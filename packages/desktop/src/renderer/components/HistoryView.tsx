import { useState } from "react";
import { ArrowLeft, History, Trash2 } from "lucide-react";
import { formatDate, formatDuration } from "@koe/shared";
import { useDeleteJob, useJob, useJobTopics, useJobs } from "~/renderer/hooks/useJobs";

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
              className="flex w-full flex-col gap-1 rounded-[10px] border border-[rgba(0,0,0,0.03)] bg-white p-4 text-left hover:border-brand/30"
            >
              <div className="flex items-center justify-between">
                <span className="truncate text-[13px] font-semibold text-text-primary">
                  {formatDate(job.created_at)}
                </span>
                <span className="shrink-0 rounded-badge bg-surface px-2 py-0.5 text-[10px] font-medium text-text-secondary">
                  {job.status}
                </span>
              </div>
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
  const [confirming, setConfirming] = useState(false);

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
          {job.audio_duration_sec != null && (
            <p className="mt-1 font-mono text-[11px] text-text-secondary">
              {formatDuration(job.audio_duration_sec)}
            </p>
          )}
          <p className="mt-1 text-[11px] text-text-secondary">ステータス: {job.status}</p>
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

      {job.status === "failed" && job.error && (
        <p className="rounded-[8px] bg-error/10 p-3 text-xs text-error">{job.error}</p>
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
