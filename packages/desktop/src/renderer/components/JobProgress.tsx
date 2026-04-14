interface JobProgressProps {
  completedChunks: number;
  totalChunks: number | null;
}

export function JobProgress({ completedChunks, totalChunks }: JobProgressProps) {
  if (!totalChunks || totalChunks === 0) return null;
  const pct = Math.round((completedChunks / totalChunks) * 100);

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-500">
        <span>
          {completedChunks} / {totalChunks} チャンク
        </span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-gray-200">
        <div className="h-2 rounded-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
