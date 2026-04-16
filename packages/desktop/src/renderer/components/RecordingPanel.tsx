import { useCallback, useEffect, useState } from "react";
import { Mic, Square, RotateCcw, Settings, Download, Upload } from "lucide-react";
import { formatDuration } from "@koe/shared";
import { useRecording, type AudioSourceMode } from "~/renderer/hooks/useRecording";

interface RecordingPanelProps {
  onRecordingComplete: (blob: Blob) => void;
  onFileSelect?: () => void;
  fileSelectDisabled?: boolean;
  transcribing?: boolean;
}

export function RecordingPanel({
  onRecordingComplete,
  onFileSelect,
  fileSelectDisabled,
  transcribing,
}: RecordingPanelProps) {
  const {
    state,
    duration,
    audioBlob,
    audioUrl,
    error,
    audioDevices,
    startRecording,
    stopRecording,
    reset,
  } = useRecording();

  const [mode, setMode] = useState<AudioSourceMode>("mic");
  const [selectedDevice, setSelectedDevice] = useState("");
  const [screenPermission, setScreenPermission] = useState<boolean | null>(null);

  const needsScreenPermission = mode === "system" || mode === "both";
  const canStart =
    state === "idle" && !audioUrl && !(needsScreenPermission && screenPermission === false);
  const showDualRows = !!transcribing && !!audioUrl;

  const checkScreenPermission = useCallback(async () => {
    const status = await window.electronAPI.checkPermissions();
    setScreenPermission(status.screen);
  }, []);

  useEffect(() => {
    if (needsScreenPermission) {
      checkScreenPermission();
    }
  }, [needsScreenPermission, checkScreenPermission]);

  const handleOpenSettings = async () => {
    await window.electronAPI.openScreenRecordingSettings();
  };

  const handleStart = () => startRecording(mode, selectedDevice || undefined);

  const handleUse = () => {
    if (audioBlob) onRecordingComplete(audioBlob);
  };

  const handleDownload = async () => {
    if (!audioBlob) return;
    const buffer = await audioBlob.arrayBuffer();
    const defaultName = `recording-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.webm`;
    await window.electronAPI.saveAudioFile(buffer, defaultName);
  };

  const modeSelector = (
    <div
      className={`flex shrink-0 items-center gap-1.5 ${state === "recording" ? "opacity-50" : ""}`}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/[0.06]">
        <Mic size={18} className="text-brand" />
      </div>
      {(["mic", "system", "both"] as const).map((m) => (
        <button
          key={m}
          onClick={() => setMode(m)}
          disabled={state === "recording"}
          className={`shrink-0 rounded-button px-3 py-1.5 text-xs font-medium ${
            mode === m
              ? "bg-text-primary text-white"
              : "border border-border text-text-primary hover:bg-surface"
          }`}
        >
          {m === "mic" ? "マイク" : m === "system" ? "システム音声" : "両方"}
        </button>
      ))}
    </div>
  );

  const idleActions = (
    <div className="flex shrink-0 items-center gap-2">
      {onFileSelect && (
        <button
          onClick={onFileSelect}
          disabled={fileSelectDisabled}
          className="flex shrink-0 items-center gap-1.5 rounded-button border border-border px-3 py-1.5 text-xs text-text-primary hover:bg-surface disabled:opacity-50"
        >
          <Upload size={12} />
          ファイル
        </button>
      )}
      <button
        onClick={handleStart}
        className="flex shrink-0 items-center gap-1.5 rounded-button bg-brand px-4 py-1.5 text-xs font-medium text-white hover:opacity-90"
      >
        <Mic size={14} />
        録音開始
      </button>
    </div>
  );

  return (
    <div className="space-y-2">
      {/* Main bar */}
      <div className="flex items-center justify-between gap-4">
        {/* Left side */}
        {!audioUrl || showDualRows ? (
          modeSelector
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <audio src={audioUrl} controls className="h-8 min-w-0 flex-1" />
          </div>
        )}

        {/* Right side */}
        <div className="flex shrink-0 items-center gap-2">
          {(canStart || showDualRows) && idleActions}

          {state === "recording" && (
            <>
              <span className="shrink-0 font-mono text-xs font-semibold text-brand">
                ● {formatDuration(duration)}
              </span>
              <button
                onClick={stopRecording}
                className="flex shrink-0 items-center gap-1.5 rounded-button bg-text-primary px-4 py-1.5 text-xs font-medium text-white hover:opacity-90"
              >
                <Square size={14} />
                停止
              </button>
            </>
          )}

          {audioUrl && !showDualRows && (
            <>
              <button
                onClick={handleUse}
                className="shrink-0 rounded-button bg-text-primary px-4 py-1.5 text-xs font-medium text-white hover:opacity-90"
              >
                この録音を使う
              </button>
              <button
                onClick={handleDownload}
                className="flex shrink-0 items-center gap-1 rounded-button border border-border px-3 py-1.5 text-xs text-text-primary hover:bg-surface"
              >
                <Download size={12} />
                保存
              </button>
              <button
                onClick={reset}
                className="flex shrink-0 items-center gap-1 rounded-button border border-border px-3 py-1.5 text-xs text-text-primary hover:bg-surface"
              >
                <RotateCcw size={12} />
                やり直す
              </button>
            </>
          )}
        </div>
      </div>

      {/* Recording preview row (when transcribing with a recording) */}
      {showDualRows && (
        <div className="flex items-center justify-between gap-4 rounded-[10px] border border-[rgba(0,0,0,0.03)] bg-surface px-4 py-2.5">
          <audio src={audioUrl} controls className="h-8 min-w-0 flex-1" />
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={handleDownload}
              className="flex shrink-0 items-center gap-1 rounded-button border border-border px-3 py-1.5 text-xs text-text-primary hover:bg-white"
            >
              <Download size={12} />
              保存
            </button>
            <button
              onClick={reset}
              className="flex shrink-0 items-center gap-1 rounded-button border border-border px-3 py-1.5 text-xs text-text-primary hover:bg-white"
            >
              <RotateCcw size={12} />
              やり直す
            </button>
          </div>
        </div>
      )}

      {/* Secondary rows */}
      {(mode === "mic" || mode === "both") && audioDevices.length > 0 && !audioUrl && (
        <select
          value={selectedDevice}
          onChange={(e) => setSelectedDevice(e.target.value)}
          disabled={state === "recording"}
          className="w-full rounded-button border border-border px-3 py-1.5 text-xs text-text-primary"
        >
          <option value="">デフォルトマイク</option>
          {audioDevices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || d.deviceId.slice(0, 20)}
            </option>
          ))}
        </select>
      )}

      {needsScreenPermission && screenPermission === false && (
        <div className="rounded-button border border-border bg-surface px-3 py-2">
          <p className="text-xs text-text-secondary">
            システム音声の録音には「画面収録」の権限が必要です。
            <br />
            システム設定で許可した後、アプリを再起動してください。
          </p>
          <button
            onClick={handleOpenSettings}
            className="mt-2 flex items-center gap-1.5 rounded-button border border-border px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface"
          >
            <Settings size={14} />
            システム設定を開く
          </button>
        </div>
      )}

      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}
