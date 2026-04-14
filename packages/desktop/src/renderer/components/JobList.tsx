import { formatDate } from "@koe/shared";
import type { Job } from "@koe/shared";
import { StatusBadge } from "./StatusBadge";

interface JobListProps {
  jobs: Job[];
  onSelect: (jobId: string) => void;
}

export function JobList({ jobs, onSelect }: JobListProps) {
  if (jobs.length === 0) {
    return <p className="text-sm text-gray-500">ジョブはまだありません</p>;
  }

  return (
    <div className="space-y-2">
      {jobs.map((job) => (
        <button
          key={job.id}
          onClick={() => onSelect(job.id)}
          className="w-full rounded-lg border bg-white p-3 text-left shadow-sm hover:bg-gray-50"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium truncate">{job.id.slice(0, 8)}</span>
            <StatusBadge status={job.status} />
          </div>
          <p className="mt-1 text-xs text-gray-500">{formatDate(job.created_at)}</p>
        </button>
      ))}
    </div>
  );
}
