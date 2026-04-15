import { formatDate, formatDuration } from "@koe/shared";
import { ArrowLeft } from "lucide-react";
import { useJobDetail } from "~/renderer/hooks/useJobDetail";
import { StatusBadge } from "./StatusBadge";
import { JobProgress } from "./JobProgress";
import { TopicViewer } from "./TopicViewer";

interface JobDetailProps {
  jobId: string;
  onBack?: () => void;
}

export function JobDetail({ jobId, onBack }: JobDetailProps) {
  const { job, topics, loading, error } = useJobDetail(jobId);

  if (loading && !job) {
    return (
      <div className="flex justify-center py-8">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return <p className="text-xs text-error">{error}</p>;
  }

  if (!job) {
    return <p className="text-xs text-text-secondary">ジョブが見つかりません</p>;
  }

  return (
    <div className="flex-1 space-y-4">
      {onBack && (
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft size={14} />
          ジョブ一覧に戻る
        </button>
      )}

      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-text-primary">
          {job.audio_key?.split("/").pop() ?? `ジョブ ${job.id.slice(0, 8)}`}
        </h2>
        <StatusBadge status={job.status} />
      </div>

      <div className="flex gap-8">
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-text-secondary">作成日時</p>
          <p className="font-mono text-[13px] text-text-primary">{formatDate(job.created_at)}</p>
        </div>
        {job.total_chunks != null && (
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-text-secondary">チャンク数</p>
            <p className="font-mono text-[13px] text-text-primary">
              {job.completed_chunks} / {job.total_chunks}
            </p>
          </div>
        )}
        {job.audio_duration_sec != null && (
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-text-secondary">長さ</p>
            <p className="font-mono text-[13px] text-text-primary">
              {formatDuration(job.audio_duration_sec)}
            </p>
          </div>
        )}
      </div>

      {job.status === "processing" && job.total_chunks != null && (
        <JobProgress completedChunks={job.completed_chunks} totalChunks={job.total_chunks} />
      )}

      {job.status === "failed" && job.error && <p className="text-xs text-error">{job.error}</p>}

      {job.status === "completed" && (
        <div className="space-y-3">
          {job.summary && (
            <div className="rounded-[10px] border border-[rgba(0,0,0,0.03)] bg-[#f8f8f8] p-4">
              <h3 className="text-[13px] font-semibold text-text-primary">概要</h3>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">{job.summary}</p>
            </div>
          )}
          <h3 className="text-[15px] font-semibold text-text-primary">トピック</h3>
          <TopicViewer topics={topics} />
        </div>
      )}
    </div>
  );
}
