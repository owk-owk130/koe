import { useEffect, useState } from "react";
import { LogOut, Settings as SettingsIcon } from "lucide-react";
import { useAuth } from "~/renderer/hooks/useAuth";

export function SettingsPanel() {
  const { user, logout } = useAuth();
  const [permissions, setPermissions] = useState<{ microphone: boolean; screen: boolean } | null>(
    null,
  );

  useEffect(() => {
    window.electronAPI.checkPermissions().then(setPermissions);
  }, []);

  const requestMic = async () => {
    const granted = await window.electronAPI.requestMicPermission();
    const next = await window.electronAPI.checkPermissions();
    setPermissions(next);
    return granted;
  };

  const openScreenSettings = () => {
    window.electronAPI.openScreenRecordingSettings();
  };

  return (
    <div className="flex flex-1 flex-col gap-5 p-6">
      <h1 className="flex items-center gap-2 text-xl font-semibold text-text-primary">
        <SettingsIcon size={18} />
        設定
      </h1>

      {/* Account */}
      <section className="rounded-[12px] border border-[rgba(0,0,0,0.03)] bg-white p-5">
        <h2 className="mb-4 text-[15px] font-semibold text-text-primary">アカウント</h2>
        {user ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface text-xs font-semibold text-text-primary">
                {user.name?.charAt(0) ?? user.email.charAt(0).toUpperCase()}
              </div>
              <div>
                {user.name && (
                  <p className="text-[13px] font-medium text-text-primary">{user.name}</p>
                )}
                <p className="text-[11px] text-text-secondary">{user.email}</p>
              </div>
            </div>
            <button
              onClick={logout}
              className="flex items-center gap-1.5 rounded-button border border-border px-3 py-1.5 text-xs text-text-primary hover:bg-surface"
            >
              <LogOut size={12} />
              ログアウト
            </button>
          </div>
        ) : (
          <p className="text-xs text-text-secondary">未ログイン</p>
        )}
      </section>

      {/* Permissions */}
      <section className="rounded-[12px] border border-[rgba(0,0,0,0.03)] bg-white p-5">
        <h2 className="mb-4 text-[15px] font-semibold text-text-primary">権限</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] text-text-primary">マイク</p>
              <p className="text-[11px] text-text-secondary">
                {permissions?.microphone ? "許可済み" : "未許可"}
              </p>
            </div>
            {!permissions?.microphone && (
              <button
                onClick={requestMic}
                className="rounded-button border border-border px-3 py-1.5 text-xs text-text-primary hover:bg-surface"
              >
                許可する
              </button>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] text-text-primary">画面収録</p>
              <p className="text-[11px] text-text-secondary">
                {permissions?.screen ? "許可済み" : "システム設定で許可してください"}
              </p>
            </div>
            {!permissions?.screen && (
              <button
                onClick={openScreenSettings}
                className="rounded-button border border-border px-3 py-1.5 text-xs text-text-primary hover:bg-surface"
              >
                システム設定を開く
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
