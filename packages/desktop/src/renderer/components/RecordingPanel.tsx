import { useState } from "react";
import { Mic, Square, RotateCcw } from "lucide-react";
import { formatDuration } from "@koe/shared";
import { useRecording, type AudioSourceMode } from "~/renderer/hooks/useRecording";

interface RecordingPanelProps {
  onRecordingComplete: (blob: Blob) => void;
}

export function RecordingPanel({ onRecordingComplete }: RecordingPanelProps) {
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

  const handleStart = () => startRecording(mode, selectedDevice || undefined);

  const handleUse = () => {
    if (audioBlob) onRecordingComplete(audioBlob);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {(["mic", "system", "both"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            disabled={state === "recording"}
            className={`rounded-button px-3 py-1.5 text-xs font-medium ${
              mode === m
                ? "bg-text-primary text-white"
                : "border border-border text-text-primary hover:bg-surface"
            }`}
          >
            {m === "mic" ? "マイク" : m === "system" ? "システム音声" : "両方"}
          </button>
        ))}
      </div>

      {(mode === "mic" || mode === "both") && audioDevices.length > 0 && (
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

      <div className="flex items-center gap-3">
        {state === "idle" && !audioUrl && (
          <button
            onClick={handleStart}
            className="flex items-center gap-1.5 rounded-button bg-brand px-4 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            <Mic size={14} />
            録音開始
          </button>
        )}

        {state === "recording" && (
          <>
            <button
              onClick={stopRecording}
              className="flex items-center gap-1.5 rounded-button bg-text-primary px-4 py-1.5 text-xs font-medium text-white hover:opacity-90"
            >
              <Square size={14} />
              停止
            </button>
            <span className="font-mono text-xs font-semibold text-brand">
              ● {formatDuration(duration)}
            </span>
          </>
        )}

        {audioUrl && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleUse}
              className="rounded-button bg-text-primary px-4 py-1.5 text-xs font-medium text-white hover:opacity-90"
            >
              この録音を使う
            </button>
            <button
              onClick={reset}
              className="flex items-center gap-1 rounded-button border border-border px-3 py-1.5 text-xs text-text-primary hover:bg-surface"
            >
              <RotateCcw size={12} />
              やり直す
            </button>
          </div>
        )}
      </div>

      {audioUrl && <audio controls src={audioUrl} className="w-full" />}

      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}
