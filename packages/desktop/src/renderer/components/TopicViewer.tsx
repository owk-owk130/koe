import { formatDuration } from "@koe/shared";
import type { useJobDetail } from "~/renderer/hooks/useJobDetail";

export function TopicViewer({ topics }: { topics: ReturnType<typeof useJobDetail>["topics"] }) {
  if (topics.length === 0) {
    return <p className="text-sm text-text-secondary">トピックはありません</p>;
  }

  return (
    <div className="space-y-3">
      {topics.map((topic) => (
        <div
          key={topic.id}
          className="rounded-[10px] border border-[rgba(0,0,0,0.03)] bg-white p-4"
        >
          <div className="flex items-start justify-between">
            <h3 className="text-[13px] font-semibold text-text-primary">{topic.title}</h3>
            {topic.start_sec != null && topic.end_sec != null && (
              <span className="font-mono text-[11px] text-text-secondary">
                {formatDuration(topic.start_sec)} - {formatDuration(topic.end_sec)}
              </span>
            )}
          </div>
          {topic.summary && (
            <p className="mt-1 text-xs leading-relaxed text-text-secondary">{topic.summary}</p>
          )}
          {topic.detail && (
            <p className="mt-2 text-xs leading-relaxed text-text-primary">{topic.detail}</p>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] text-text-secondary hover:text-text-primary">
              トランスクリプト
            </summary>
            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-text-primary">
              {topic.transcript}
            </p>
          </details>
        </div>
      ))}
    </div>
  );
}
