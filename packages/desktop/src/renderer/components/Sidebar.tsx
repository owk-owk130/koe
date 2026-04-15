import { AudioWaveform, List, LogOut, Mic, Plus } from "lucide-react";
import { statusLabel, type Job } from "@koe/shared";

type View = "transcribe" | "jobs";

interface SidebarProps {
  view: View;
  setView: (v: View) => void;
  jobs: Job[];
  selectedJobId: string | null;
  onSelectJob: (id: string) => void;
  onNewJob: () => void;
  onLogout: () => void;
  userInitial: string | null;
  userEmail: string | null;
}

export function Sidebar({
  view,
  setView,
  jobs,
  selectedJobId,
  onSelectJob,
  onNewJob,
  onLogout,
  userInitial,
  userEmail,
}: SidebarProps) {
  return (
    <aside className="flex w-60 flex-col border-r border-r-[rgba(0,0,0,0.03)] bg-white">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 pb-3 pt-4">
        <Mic size={18} className="text-brand" />
        <span className="text-[15px] font-semibold text-text-primary">koe</span>
      </div>

      {/* Nav */}
      <nav className="space-y-0.5 px-2">
        <button
          onClick={() => setView("transcribe")}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] ${
            view === "transcribe"
              ? "bg-surface font-medium text-text-primary"
              : "text-text-secondary hover:bg-surface/50"
          }`}
        >
          <AudioWaveform size={16} />
          クイック文字起こし
        </button>
        <button
          onClick={() => setView("jobs")}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] ${
            view === "jobs" && !selectedJobId
              ? "bg-surface font-medium text-text-primary"
              : "text-text-secondary hover:bg-surface/50"
          }`}
        >
          <List size={16} />
          ジョブ一覧
        </button>
      </nav>

      {/* Separator */}
      <div className="mx-4 my-2 h-px bg-surface" />

      {/* Job list header */}
      <div className="flex items-center justify-between px-4 py-1">
        <span className="text-[11px] font-semibold tracking-wide text-text-secondary">
          最近のジョブ
        </span>
        <button onClick={onNewJob} className="text-text-secondary hover:text-text-primary">
          <Plus size={14} />
        </button>
      </div>

      {/* Job list */}
      <div className="flex-1 space-y-0.5 overflow-auto px-2">
        {jobs.map((job) => {
          const isSelected = selectedJobId === job.id;
          const isProcessing = job.status === "processing" || job.status === "pending";
          return (
            <button
              key={job.id}
              onClick={() => {
                onSelectJob(job.id);
                setView("jobs");
              }}
              className={`flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left ${
                isSelected ? "bg-brand/[0.08]" : "hover:bg-surface/50"
              }`}
            >
              <span
                className={`truncate text-xs font-medium ${isSelected ? "text-brand" : "text-text-primary"}`}
              >
                {job.audio_key?.split("/").pop() ?? job.id.slice(0, 8)}
              </span>
              <span
                className={`text-[11px] ${isProcessing ? "text-brand" : "text-text-secondary"}`}
              >
                {statusLabel(job.status)}
              </span>
            </button>
          );
        })}
      </div>

      {/* User */}
      {userInitial && (
        <div className="flex items-center gap-2 border-t border-surface px-4 py-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-surface text-xs font-semibold text-text-primary">
            {userInitial}
          </div>
          {userEmail && (
            <span className="flex-1 truncate text-[11px] text-text-secondary">{userEmail}</span>
          )}
          <button
            onClick={onLogout}
            className="text-text-secondary hover:text-text-primary"
          >
            <LogOut size={14} />
          </button>
        </div>
      )}
    </aside>
  );
}
