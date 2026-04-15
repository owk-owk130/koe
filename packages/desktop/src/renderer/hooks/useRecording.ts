import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopSource, RecordingState } from "../../shared/ipc-channels";

export type AudioSourceMode = "mic" | "system" | "both";

interface UseRecordingReturn {
  state: RecordingState;
  duration: number;
  audioBlob: Blob | null;
  audioUrl: string | null;
  error: string | null;
  sources: DesktopSource[];
  audioDevices: MediaDeviceInfo[];
  startRecording: (mode: AudioSourceMode, micDeviceId?: string) => Promise<void>;
  stopRecording: () => void;
  reset: () => void;
}

export function useRecording(): UseRecordingReturn {
  const [state, setState] = useState<RecordingState>("idle");
  const [duration, setDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<DesktopSource[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamsRef = useRef<MediaStream[]>([]);

  // 外部システム（Electron + MediaDevices）との同期: デバイス一覧の取得
  useEffect(() => {
    let cancelled = false;

    async function init() {
      const desktopSources = await window.electronAPI.getDesktopSources();
      if (cancelled) return;
      setSources(desktopSources);

      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!cancelled) setAudioDevices(devices.filter((d) => d.kind === "audioinput"));
    }
    init();

    return () => {
      cancelled = true;
    };
  }, []);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streamsRef.current = [];
  }, []);

  const startRecording = useCallback(
    async (mode: AudioSourceMode, micDeviceId?: string) => {
      setError(null);
      chunksRef.current = [];

      try {
        let stream: MediaStream;

        if (mode === "mic") {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: micDeviceId ? { deviceId: { exact: micDeviceId } } : true,
          });
          streamsRef.current = [stream];
        } else if (mode === "system") {
          const src = sources[0];
          if (!src) throw new Error("No screen source available");
          const sysStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              // @ts-expect-error Electron-specific mandatory constraint
              mandatory: { chromeMediaSource: "desktop" },
            },
            video: {
              // @ts-expect-error Electron-specific mandatory constraint
              mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: src.id,
                maxWidth: 1,
                maxHeight: 1,
              },
            },
          });
          sysStream.getVideoTracks().forEach((t) => {
            t.stop();
            sysStream.removeTrack(t);
          });
          stream = sysStream;
          streamsRef.current = [stream];
        } else {
          const src = sources[0];
          if (!src) throw new Error("No screen source available");

          const sysStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              // @ts-expect-error Electron-specific mandatory constraint
              mandatory: { chromeMediaSource: "desktop" },
            },
            video: {
              // @ts-expect-error Electron-specific mandatory constraint
              mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: src.id,
                maxWidth: 1,
                maxHeight: 1,
              },
            },
          });
          sysStream.getVideoTracks().forEach((t) => {
            t.stop();
            sysStream.removeTrack(t);
          });

          const micStream = await navigator.mediaDevices.getUserMedia({
            audio: micDeviceId ? { deviceId: { exact: micDeviceId } } : true,
          });

          const ctx = new AudioContext();
          const dest = ctx.createMediaStreamDestination();
          ctx.createMediaStreamSource(sysStream).connect(dest);
          ctx.createMediaStreamSource(micStream).connect(dest);
          stream = dest.stream;
          streamsRef.current = [sysStream, micStream];
        }

        const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
        recorderRef.current = recorder;

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });
          setAudioBlob(blob);
          setAudioUrl(URL.createObjectURL(blob));
          setState("idle");
          cleanup();
        };

        recorder.start(1000);
        setState("recording");
        setDuration(0);
        window.electronAPI.notifyRecordingState("recording");

        timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        cleanup();
      }
    },
    [sources, cleanup],
  );

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
    window.electronAPI.notifyRecordingState("idle");
  }, []);

  const reset = useCallback(() => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(null);
    setAudioUrl(null);
    setDuration(0);
    setError(null);
  }, [audioUrl]);

  // Listen for tray toggle
  useEffect(() => {
    const unsub = window.electronAPI.onToggleRecording(() => {
      if (state === "recording") {
        stopRecording();
      } else if (state === "idle") {
        startRecording("mic");
      }
    });
    return unsub;
  }, [state, startRecording, stopRecording]);

  return {
    state,
    duration,
    audioBlob,
    audioUrl,
    error,
    sources,
    audioDevices,
    startRecording,
    stopRecording,
    reset,
  };
}
