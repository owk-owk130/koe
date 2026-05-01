import { statusLabel } from "@koe/shared";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-[#fef3c7] text-[#92400e]",
  transcribing: "bg-brand-light text-brand",
  transcribed: "bg-[#dbeafe] text-[#1e40af]",
  analyzing: "bg-brand-light text-brand",
  completed: "bg-[#dcfce7] text-[#166534]",
  transcribe_failed: "bg-[#fee2e2] text-error",
  analyze_failed: "bg-[#fee2e2] text-error",
  // legacy single-phase values kept for older rows.
  processing: "bg-brand-light text-brand",
  failed: "bg-[#fee2e2] text-error",
};

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "bg-surface text-text-secondary";
  return (
    <span className={`inline-block rounded-badge px-2 py-0.5 text-[11px] font-medium ${color}`}>
      {statusLabel(status)}
    </span>
  );
}
