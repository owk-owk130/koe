import { formatDuration } from "@koe/shared";
import type { Topic } from "@koe/shared";

export function TopicViewer({ topics }: { topics: Topic[] }) {
  if (topics.length === 0) {
    return <p className="text-sm text-gray-500">トピックはありません</p>;
  }

  return (
    <div className="space-y-4">
      {topics.map((topic) => (
        <div key={topic.id} className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <h3 className="font-semibold">{topic.title}</h3>
            {topic.start_sec != null && topic.end_sec != null && (
              <span className="text-xs text-gray-500">
                {formatDuration(topic.start_sec)} - {formatDuration(topic.end_sec)}
              </span>
            )}
          </div>
          {topic.summary && <p className="mt-1 text-sm text-gray-600">{topic.summary}</p>}
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">
              トランスクリプト
            </summary>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{topic.transcript}</p>
          </details>
        </div>
      ))}
    </div>
  );
}
