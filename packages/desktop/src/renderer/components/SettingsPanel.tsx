import { useCallback, useEffect, useState } from "react";
import { Key, LogOut, Settings as SettingsIcon } from "lucide-react";
import type { AiSecretsStatus } from "~/shared/ipc-channels";
import { useAuth } from "~/renderer/hooks/useAuth";

const GEMINI_MODEL_PLACEHOLDER = "gemini-2.5-flash";

interface SecretRowProps {
  label: string;
  saved: boolean | undefined;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type: "text" | "password";
  placeholder: string;
}

function SecretRow({ label, saved, value, onChange, type, placeholder }: SecretRowProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-44 shrink-0">
        <p className="text-[12px] text-text-primary">{label}</p>
        <p className={`text-[10px] ${saved ? "text-success" : "text-text-secondary"}`}>
          {saved ? "保存済み" : "未設定"}
        </p>
      </div>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="flex-1 rounded-button border border-border bg-white px-3 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-1 focus:ring-brand"
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}

type SecretsForm = {
  geminiApiKey: string;
  geminiModel: string;
  cfApiToken: string;
  cfAccountId: string;
};

const EMPTY_FORM: SecretsForm = {
  geminiApiKey: "",
  geminiModel: "",
  cfApiToken: "",
  cfAccountId: "",
};

export function SettingsPanel() {
  const { user, logout } = useAuth();
  const [permissions, setPermissions] = useState<{ microphone: boolean; screen: boolean } | null>(
    null,
  );
  const [secretsStatus, setSecretsStatus] = useState<AiSecretsStatus | null>(null);
  const [form, setForm] = useState<SecretsForm>(EMPTY_FORM);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      window.electronAPI.checkPermissions(),
      window.electronAPI.getSecretsStatus(),
    ]).then(([perms, status]) => {
      setPermissions(perms);
      setSecretsStatus(status);
    });
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

  const updateField = useCallback(
    (field: keyof SecretsForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
    },
    [],
  );

  // Only fields the user actually typed into are written. Empty inputs are
  // ignored so the user can update one key without re-entering the others
  // (the inputs render blank because we never read existing values back).
  const saveSecrets = useCallback(async () => {
    const patch: SecretsForm = {
      geminiApiKey: form.geminiApiKey.trim(),
      geminiModel: form.geminiModel.trim(),
      cfApiToken: form.cfApiToken.trim(),
      cfAccountId: form.cfAccountId.trim(),
    };
    const toSend: Partial<SecretsForm> = {};
    for (const k of Object.keys(patch) as (keyof SecretsForm)[]) {
      if (patch[k].length > 0) toSend[k] = patch[k];
    }
    if (Object.keys(toSend).length === 0) return;
    await window.electronAPI.setSecrets(toSend);
    const next = await window.electronAPI.getSecretsStatus();
    setSecretsStatus(next);
    setForm(EMPTY_FORM);
    setSavedAt(Date.now());
  }, [form]);

  const clearAllSecrets = useCallback(async () => {
    await window.electronAPI.clearSecrets();
    const next = await window.electronAPI.getSecretsStatus();
    setSecretsStatus(next);
    setForm(EMPTY_FORM);
    setSavedAt(null);
  }, []);

  const savedRecently = savedAt !== null && Date.now() - savedAt < 3000;

  // Saved-state inputs share a "再入力で上書き" placeholder so the UI doesn't
  // hint at the actual stored value (which we never read back into the
  // renderer). Unsaved inputs show a per-field example.
  const placeholderFor = (saved: boolean | undefined, unsavedHint: string): string =>
    saved ? "保存済み（再入力で上書き）" : unsavedHint;

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

      {/* API Keys (BYOK) */}
      <section className="rounded-[12px] border border-[rgba(0,0,0,0.03)] bg-white p-5">
        <h2 className="mb-1 flex items-center gap-2 text-[15px] font-semibold text-text-primary">
          <Key size={14} />
          API キー
        </h2>
        <p className="mb-4 text-[11px] text-text-secondary">
          未入力なら koe 側の既定値で動きます。入力したジョブ以降そちらを使います。
        </p>
        <div className="space-y-3">
          <SecretRow
            label="Gemini API Key"
            saved={secretsStatus?.geminiApiKey}
            value={form.geminiApiKey}
            onChange={updateField("geminiApiKey")}
            type="password"
            placeholder={placeholderFor(secretsStatus?.geminiApiKey, "AIza...")}
          />
          <SecretRow
            label="Gemini Model"
            saved={secretsStatus?.geminiModel}
            value={form.geminiModel}
            onChange={updateField("geminiModel")}
            type="text"
            placeholder={placeholderFor(secretsStatus?.geminiModel, GEMINI_MODEL_PLACEHOLDER)}
          />
          <SecretRow
            label="Cloudflare API Token"
            saved={secretsStatus?.cfApiToken}
            value={form.cfApiToken}
            onChange={updateField("cfApiToken")}
            type="password"
            placeholder={placeholderFor(secretsStatus?.cfApiToken, "Workers AI 権限のトークン")}
          />
          <SecretRow
            label="Cloudflare Account ID"
            saved={secretsStatus?.cfAccountId}
            value={form.cfAccountId}
            onChange={updateField("cfAccountId")}
            type="text"
            placeholder={placeholderFor(secretsStatus?.cfAccountId, "32 文字のアカウント ID")}
          />
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-[11px] text-text-secondary">
            {savedRecently ? "保存しました" : "値はローカルの OS keychain に暗号化保存されます"}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={clearAllSecrets}
              className="rounded-button border border-border px-3 py-1.5 text-xs text-text-primary hover:bg-surface"
            >
              すべて削除
            </button>
            <button
              onClick={saveSecrets}
              className="rounded-button bg-text-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
            >
              保存
            </button>
          </div>
        </div>
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
