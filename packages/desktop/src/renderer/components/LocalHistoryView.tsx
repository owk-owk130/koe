import { useState } from "react";
import { ArrowLeft, History } from "lucide-react";
import { formatDate, formatDuration } from "@koe/shared";
import { useLocalHistory, useLocalJobDetail } from "~/renderer/hooks/useLocalHistory";

export function LocalHistoryView() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (selectedId) {
    return <LocalJobDetailView jobId={selectedId} onBack={() => setSelectedId(null)} />;
  }
  return <LocalHistoryList onSelect={setSelectedId} />;
}

function LocalHistoryList({ onSelect }: { onSelect: (id: string) => void }) {
  const { data, isLoading, error } = useLocalHistory();
  const jobs = data ?? [];

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
          {jobs.map((job) => {
            const filename = job.audioKey.split("/").pop() ?? job.id.slice(0, 8);
            return (
              <button
                key={job.id}
                onClick={() => onSelect(job.id)}
                className="flex w-full flex-col gap-1 rounded-[10px] border border-[rgba(0,0,0,0.03)] bg-white p-4 text-left hover:border-brand/30"
              >
                <div className="flex items-center justify-between">
                  <span className="truncate text-[13px] font-semibold text-text-primary">
                    {filename}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-text-secondary">
                    {formatDate(job.createdAt)}
                  </span>
                </div>
                {job.summary && (
                  <p className="line-clamp-2 text-xs leading-relaxed text-text-secondary">
                    {job.summary}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LocalJobDetailView({ jobId, onBack }: { jobId: string; onBack: () => void }) {
  const { data, isLoading, error } = useLocalJobDetail(jobId);

  if (isLoading) {
    return <p className="p-6 text-xs text-text-secondary">読み込み中...</p>;
  }
  if (error) {
    return <p className="p-6 text-xs text-error">{error.message}</p>;
  }
  if (!data) {
    return <p className="p-6 text-xs text-text-secondary">見つかりませんでした</p>;
  }

  const { job, topics, chunks } = data;
  const filename = job.audioKey.split("/").pop() ?? job.id.slice(0, 8);

  return (
    <div className="flex flex-1 flex-col gap-5 p-6">
      <button
        onClick={onBack}
        className="flex w-fit items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft size={12} />
        履歴一覧に戻る
      </button>

      <div>
        <h1 className="text-xl font-semibold text-text-primary">{filename}</h1>
        <p className="mt-1 font-mono text-[11px] text-text-secondary">
          {formatDate(job.createdAt)}
        </p>
      </div>

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
                  {topic.startSec !== null && topic.endSec !== null && (
                    <span className="shrink-0 font-mono text-[11px] text-text-secondary">
                      {formatDuration(topic.startSec)} - {formatDuration(topic.endSec)}
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
              </div>
            ))}
          </div>
        </>
      )}

      {chunks.length > 0 && (
        <>
          <h2 className="text-[15px] font-semibold text-text-primary">トランスクリプト</h2>
          <div className="rounded-[12px] border border-[rgba(0,0,0,0.03)] bg-white p-4">
            <div className="space-y-2">
              {chunks.map((chunk) => (
                <p
                  key={chunk.id}
                  className="whitespace-pre-wrap text-[13px] leading-relaxed text-text-primary"
                >
                  <span className="mr-2 font-mono text-[11px] text-text-secondary">
                    {formatDuration(chunk.startSec)}
                  </span>
                  {chunk.transcript ?? ""}
                </p>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
