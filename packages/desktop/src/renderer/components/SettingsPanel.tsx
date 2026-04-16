import { useState, useEffect } from "react";
import { Save, Eye, EyeOff } from "lucide-react";
import { useSettings } from "~/renderer/hooks/useSettings";
import { useSidecar } from "~/renderer/hooks/useSidecar";
import type { SidecarStatus } from "~/shared/ipc-channels";

function StatusDot({ status }: { status: SidecarStatus }) {
  const color =
    status === "ready"
      ? "bg-success"
      : status === "starting"
        ? "bg-yellow-400"
        : status === "error"
          ? "bg-error"
          : "bg-text-secondary/30";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

const STATUS_LABEL: Record<SidecarStatus, string> = {
  stopped: "停止中",
  starting: "起動中...",
  ready: "稼働中",
  error: "エラー",
};

function MaskedInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-button border border-border bg-white px-3 py-2 pr-9 font-mono text-xs text-text-primary placeholder:text-text-secondary/40 focus:border-brand focus:outline-none"
      />
      <button
        type="button"
        onClick={() => setVisible(!visible)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
      >
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

export function SettingsPanel() {
  const { settings, apiKeys, loading, saveSettings, saveApiKeys, isSaving } = useSettings();
  const sidecar = useSidecar();

  const [whisperApiKey, setWhisperApiKey] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [whisperBaseUrl, setWhisperBaseUrl] = useState("");
  const [whisperModel, setWhisperModel] = useState("");
  const [geminiModel, setGeminiModel] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings) {
      setWhisperBaseUrl(settings.whisperBaseUrl);
      setWhisperModel(settings.whisperModel);
      setGeminiModel(settings.geminiModel);
    }
  }, [settings]);

  useEffect(() => {
    if (apiKeys) {
      setWhisperApiKey(apiKeys.whisperApiKey ?? "");
      setGeminiApiKey(apiKeys.geminiApiKey ?? "");
    }
  }, [apiKeys]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    );
  }

  const handleSave = () => {
    saveSettings({ whisperBaseUrl, whisperModel, geminiModel });
    saveApiKeys({
      whisperApiKey,
      geminiApiKey: geminiApiKey || undefined,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const canSave = whisperApiKey.trim() !== "";

  return (
    <div className="flex flex-1 flex-col gap-5 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-primary">設定</h1>
        <div className="flex items-center gap-2">
          <StatusDot status={sidecar.status} />
          <span className="text-xs text-text-secondary">{STATUS_LABEL[sidecar.status]}</span>
          {sidecar.error && <span className="text-xs text-error">{sidecar.error}</span>}
        </div>
      </div>

      <div className="space-y-6">
        {/* Whisper */}
        <section className="rounded-[12px] border border-[rgba(0,0,0,0.03)] bg-white p-5">
          <h2 className="mb-4 text-[15px] font-semibold text-text-primary">Whisper (文字起こし)</h2>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">
                API Key <span className="text-error">*</span>
              </label>
              <MaskedInput value={whisperApiKey} onChange={setWhisperApiKey} placeholder="sk-..." />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Base URL</label>
              <input
                type="text"
                value={whisperBaseUrl}
                onChange={(e) => setWhisperBaseUrl(e.target.value)}
                placeholder="https://api.openai.com"
                className="w-full rounded-button border border-border bg-white px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-secondary/40 focus:border-brand focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Model</label>
              <input
                type="text"
                value={whisperModel}
                onChange={(e) => setWhisperModel(e.target.value)}
                placeholder="whisper-1"
                className="w-full rounded-button border border-border bg-white px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-secondary/40 focus:border-brand focus:outline-none"
              />
            </div>
          </div>
        </section>

        {/* Gemini */}
        <section className="rounded-[12px] border border-[rgba(0,0,0,0.03)] bg-white p-5">
          <h2 className="mb-1 text-[15px] font-semibold text-text-primary">
            Gemini (トピック分割)
          </h2>
          <p className="mb-4 text-[11px] text-text-secondary">
            未設定の場合、文字起こしのみ実行されます
          </p>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">API Key</label>
              <MaskedInput value={geminiApiKey} onChange={setGeminiApiKey} placeholder="AIza..." />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Model</label>
              <input
                type="text"
                value={geminiModel}
                onChange={(e) => setGeminiModel(e.target.value)}
                placeholder="gemini-2.0-flash-lite"
                className="w-full rounded-button border border-border bg-white px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-secondary/40 focus:border-brand focus:outline-none"
              />
            </div>
          </div>
        </section>
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={!canSave || isSaving}
          className="flex items-center gap-1.5 rounded-button bg-text-primary px-4 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          <Save size={13} />
          {isSaving ? "保存中..." : "保存"}
        </button>
        {saved && <span className="text-xs text-success">保存しました</span>}
      </div>
    </div>
  );
}
