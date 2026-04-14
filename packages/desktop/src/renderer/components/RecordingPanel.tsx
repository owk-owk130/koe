import { useState } from "react";
import { Mic, Square, RotateCcw } from "lucide-react";
import { formatDuration } from "@koe/shared";
import { useRecording, type AudioSourceMode } from "../hooks/useRecording";

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
    <div className="space-y-4">
      {/* Source selection */}
      <div className="flex gap-2">
        {(["mic", "system", "both"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            disabled={state === "recording"}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              mode === m ? "bg-blue-600 text-white" : "bg-gray-100 hover:bg-gray-200"
            }`}
          >
            {m === "mic" ? "マイク" : m === "system" ? "システム音声" : "両方"}
          </button>
        ))}
      </div>

      {/* Device selector */}
      {(mode === "mic" || mode === "both") && audioDevices.length > 0 && (
        <select
          value={selectedDevice}
          onChange={(e) => setSelectedDevice(e.target.value)}
          disabled={state === "recording"}
          className="w-full rounded border px-3 py-2 text-sm"
        >
          <option value="">デフォルトマイク</option>
          {audioDevices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || d.deviceId.slice(0, 20)}
            </option>
          ))}
        </select>
      )}

      {/* Controls */}
      <div className="flex items-center gap-4">
        {state === "idle" && !audioUrl && (
          <button
            onClick={handleStart}
            className="flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-white hover:bg-red-600"
          >
            <Mic size={18} />
            録音開始
          </button>
        )}

        {state === "recording" && (
          <>
            <button
              onClick={stopRecording}
              className="flex items-center gap-2 rounded-lg bg-gray-700 px-4 py-2 text-white hover:bg-gray-800"
            >
              <Square size={18} />
              停止
            </button>
            <span className="text-red-500 font-mono font-bold">● {formatDuration(duration)}</span>
          </>
        )}

        {audioUrl && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleUse}
              className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
            >
              この録音を使う
            </button>
            <button
              onClick={reset}
              className="flex items-center gap-1 rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
            >
              <RotateCcw size={14} />
              やり直す
            </button>
          </div>
        )}
      </div>

      {/* Playback */}
      {audioUrl && <audio controls src={audioUrl} className="w-full" />}

      {/* Error */}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
