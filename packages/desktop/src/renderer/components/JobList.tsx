import { formatDate } from "@koe/shared";
import type { Job } from "@koe/shared";
import { StatusBadge } from "./StatusBadge";

interface JobListProps {
  jobs: Job[];
  onSelect: (jobId: string) => void;
}

export function JobList({ jobs, onSelect }: JobListProps) {
  if (jobs.length === 0) {
    return <p className="text-xs text-text-secondary">ジョブはまだありません</p>;
  }

  return (
    <div className="overflow-hidden rounded-card bg-white shadow-card">
      <div className="flex h-9 items-center bg-surface px-4">
        <span className="w-24 text-[11px] font-medium text-text-secondary">ステータス</span>
        <span className="flex-1 text-[11px] font-medium text-text-secondary">ファイル名</span>
        <span className="w-40 text-[11px] font-medium text-text-secondary">作成日時</span>
      </div>
      {jobs.map((job, i) => (
        <button
          key={job.id}
          onClick={() => onSelect(job.id)}
          className={`flex h-11 w-full items-center px-4 text-left hover:bg-surface/50 ${
            i < jobs.length - 1 ? "border-b border-surface" : ""
          }`}
        >
          <span className="w-24">
            <StatusBadge status={job.status} />
          </span>
          <span className="flex-1 truncate text-[13px] text-text-primary">
            {job.audio_key?.split("/").pop() ?? job.id.slice(0, 8)}
          </span>
          <span className="w-40 font-mono text-xs text-text-secondary">
            {formatDate(job.created_at)}
          </span>
        </button>
      ))}
    </div>
  );
}
