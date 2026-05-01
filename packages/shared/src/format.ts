export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "--:--";

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (iso == null) return "--";
  const d = new Date(iso);
  return d.toLocaleDateString("ja-JP", { year: "numeric", month: "numeric", day: "numeric" });
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  if (i === 0) return `${bytes} B`;
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "待機中",
  transcribing: "文字起こし中",
  transcribed: "文字起こし完了",
  analyzing: "要約中",
  completed: "完了",
  transcribe_failed: "文字起こし失敗",
  analyze_failed: "要約失敗",
  // legacy values from the single-phase orchestrator are kept so existing rows
  // still render correctly.
  processing: "処理中",
  failed: "失敗",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
