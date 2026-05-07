import { useState } from "react";
import { ArrowLeft, History } from "lucide-react";
import { formatDate, formatDuration } from "@koe/shared";
import { useJobs } from "~/renderer/hooks/useJobs";
import { JobResultPanel } from "./JobResultPanel";
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
  return (
    <div className="flex flex-1 flex-col gap-5 p-6">
      <button
        onClick={onBack}
        className="flex w-fit items-center gap-1.5 rounded-[8px] border border-[rgba(0,0,0,0.06)] bg-white px-3 py-1.5 text-[13px] font-medium text-text-primary shadow-sm hover:border-brand/40 hover:text-brand"
      >
        <ArrowLeft size={14} />
        履歴一覧に戻る
      </button>

      <JobResultPanel jobId={jobId} onDeleted={onBack} />
    </div>
  );
}
