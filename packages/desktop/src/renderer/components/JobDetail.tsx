import { formatDate, formatDuration } from "@koe/shared";
import { ArrowLeft } from "lucide-react";
import { useJobDetail } from "../hooks/useJobDetail";
import { StatusBadge } from "./StatusBadge";
import { JobProgress } from "./JobProgress";
import { TopicViewer } from "./TopicViewer";

interface JobDetailProps {
  jobId: string;
  onBack: () => void;
}

export function JobDetail({ jobId, onBack }: JobDetailProps) {
  const { job, topics, loading, error } = useJobDetail(jobId);

  if (loading && !job) {
    return (
      <div className="flex justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (!job) {
    return <p className="text-sm text-gray-500">ジョブが見つかりません</p>;
  }

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
      >
        <ArrowLeft size={16} />
        一覧に戻る
      </button>

      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">ジョブ {job.id.slice(0, 8)}</h2>
          <StatusBadge status={job.status} />
        </div>
        <div className="mt-2 space-y-1 text-sm text-gray-600">
          <p>作成: {formatDate(job.created_at)}</p>
          {job.audio_duration_sec != null && <p>長さ: {formatDuration(job.audio_duration_sec)}</p>}
        </div>

        {job.status === "processing" && job.total_chunks != null && (
          <div className="mt-3">
            <JobProgress completedChunks={job.completed_chunks} totalChunks={job.total_chunks} />
          </div>
        )}

        {job.status === "failed" && job.error && (
          <p className="mt-3 text-sm text-red-600">{job.error}</p>
        )}
      </div>

      {job.status === "completed" && (
        <div>
          <h3 className="mb-2 font-semibold">トピック</h3>
          <TopicViewer topics={topics} />
        </div>
      )}
    </div>
  );
}
