import { AudioWaveform, History, LogIn, LogOut, Mic, Settings } from "lucide-react";

type View = "transcribe" | "history" | "settings" | "auth";

interface SidebarProps {
  view: View;
  setView: (v: View) => void;
  onLogout: () => void;
  userInitial: string | null;
  userEmail: string | null;
  isAuthenticated: boolean;
}

export function Sidebar({
  view,
  setView,
  onLogout,
  userInitial,
  userEmail,
  isAuthenticated,
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
          onClick={() => setView("history")}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] ${
            view === "history"
              ? "bg-surface font-medium text-text-primary"
              : "text-text-secondary hover:bg-surface/50"
          }`}
        >
          <History size={16} />
          履歴
        </button>
        <button
          onClick={() => setView("settings")}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] ${
            view === "settings"
              ? "bg-surface font-medium text-text-primary"
              : "text-text-secondary hover:bg-surface/50"
          }`}
        >
          <Settings size={16} />
          設定
        </button>
      </nav>

      <div className="flex-1" />

      {isAuthenticated && userInitial && (
        <div className="flex items-center gap-2 border-t border-surface px-4 py-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-surface text-xs font-semibold text-text-primary">
            {userInitial}
          </div>
          {userEmail && (
            <span className="flex-1 truncate text-[11px] text-text-secondary">{userEmail}</span>
          )}
          <button onClick={onLogout} className="text-text-secondary hover:text-text-primary">
            <LogOut size={14} />
          </button>
        </div>
      )}

      {!isAuthenticated && (
        <div className="flex flex-col gap-2.5 border-t border-surface px-4 py-4">
          <p className="text-[11px] leading-relaxed text-text-secondary">
            ログインすると履歴が
            <br />
            クラウドに同期されます
          </p>
          <button
            onClick={() => setView("auth")}
            className="flex w-full items-center justify-center gap-1.5 rounded-button bg-text-primary py-2 text-xs font-medium text-white hover:opacity-90"
          >
            <LogIn size={13} />
            Google でログイン
          </button>
        </div>
      )}
    </aside>
  );
}
