interface JobProgressProps {
  completedChunks: number;
  totalChunks: number | null;
}

export function JobProgress({ completedChunks, totalChunks }: JobProgressProps) {
  if (!totalChunks || totalChunks === 0) return null;
  const pct = Math.round((completedChunks / totalChunks) * 100);

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] text-text-secondary">
        <span>
          {completedChunks} / {totalChunks} チャンク
        </span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-surface">
        <div className="h-1.5 rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
