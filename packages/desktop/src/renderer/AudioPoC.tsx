import { useCallback, useEffect, useRef, useState } from "react";

type RecordingState = "idle" | "recording" | "stopped";
type AudioSource = "mic" | "system" | "both";

interface PermissionStatus {
  microphone: boolean;
  screen: boolean;
}

interface DesktopSource {
  id: string;
  name: string;
  display_id: string;
}

export function AudioPoC() {
  const [permissions, setPermissions] = useState<PermissionStatus | null>(null);
  const [sources, setSources] = useState<DesktopSource[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedSource, setSelectedSource] = useState<AudioSource>("mic");
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [state, setState] = useState<RecordingState>("idle");
  const [duration, setDuration] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const addLog = useCallback((msg: string) => {
    setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  // Check permissions and enumerate devices on mount
  useEffect(() => {
    async function init() {
      try {
        const perms = await window.electronAPI.checkPermissions();
        setPermissions(perms);
        addLog(`Permissions - mic: ${perms.microphone}, screen: ${perms.screen}`);

        const desktopSources = await window.electronAPI.getDesktopSources();
        setSources(desktopSources);
        addLog(`Desktop sources: ${desktopSources.length} found`);
        for (const s of desktopSources) {
          addLog(`  - ${s.name} (${s.id})`);
        }

        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter((d) => d.kind === "audioinput");
        setAudioDevices(audioInputs);
        addLog(`Audio input devices: ${audioInputs.length} found`);
        for (const d of audioInputs) {
          addLog(`  - ${d.label || "Unknown"} (${d.deviceId.slice(0, 8)}...)`);
        }
      } catch (e) {
        addLog(`Init error: ${e}`);
        setError(String(e));
      }
    }
    init();
  }, [addLog]);

  const startRecording = async () => {
    setError(null);
    chunksRef.current = [];

    try {
      let stream: MediaStream;

      if (selectedSource === "mic") {
        addLog("Requesting mic audio...");
        stream = await navigator.mediaDevices.getUserMedia({
          audio: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true,
        });
        addLog("Mic stream acquired");
      } else if (selectedSource === "system") {
        addLog("Requesting system audio via desktopCapturer...");
        // In Electron, system audio is captured via a screen source
        const screenSource = sources[0];
        if (!screenSource) {
          throw new Error("No screen source available");
        }
        addLog(`Using source: ${screenSource.name}`);
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            // @ts-expect-error Electron-specific mandatory constraint
            mandatory: {
              chromeMediaSource: "desktop",
            },
          },
          video: {
            // @ts-expect-error Electron-specific mandatory constraint
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: screenSource.id,
              maxWidth: 1,
              maxHeight: 1,
            },
          },
        });
        // Remove video track, keep only audio
        for (const track of stream.getVideoTracks()) {
          track.stop();
          stream.removeTrack(track);
        }
        addLog(`System audio stream acquired. Audio tracks: ${stream.getAudioTracks().length}`);
      } else {
        // "both" - mix system + mic
        addLog("Requesting both system + mic audio...");
        const screenSource = sources[0];
        if (!screenSource) {
          throw new Error("No screen source available");
        }

        const systemStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            // @ts-expect-error Electron-specific mandatory constraint
            mandatory: {
              chromeMediaSource: "desktop",
            },
          },
          video: {
            // @ts-expect-error Electron-specific mandatory constraint
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: screenSource.id,
              maxWidth: 1,
              maxHeight: 1,
            },
          },
        });
        for (const track of systemStream.getVideoTracks()) {
          track.stop();
          systemStream.removeTrack(track);
        }

        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true,
        });

        // Mix via AudioContext
        const ctx = new AudioContext();
        const dest = ctx.createMediaStreamDestination();
        ctx.createMediaStreamSource(systemStream).connect(dest);
        ctx.createMediaStreamSource(micStream).connect(dest);
        stream = dest.stream;
        addLog("Mixed stream acquired (system + mic)");
      }

      const recorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        addLog(`Recording saved: ${(blob.size / 1024).toFixed(1)} KB`);
      };

      recorder.start(1000);
      setState("recording");
      setDuration(0);

      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);

      addLog("Recording started");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog(`Recording error: ${msg}`);
      setError(msg);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
    }
    if (timerRef.current) clearInterval(timerRef.current);
    setState("stopped");
    addLog("Recording stopped");
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div style={{ padding: 20, fontFamily: "system-ui" }}>
      <h1>koe - Audio Capture PoC</h1>

      <section style={{ marginTop: 16 }}>
        <h2>Permissions</h2>
        {permissions ? (
          <ul>
            <li>Microphone: {permissions.microphone ? "granted" : "not granted"}</li>
            <li>Screen Recording: {permissions.screen ? "granted" : "not granted"}</li>
          </ul>
        ) : (
          <p>Checking...</p>
        )}
        <button
          onClick={async () => {
            const result = await window.electronAPI.requestMicPermission();
            addLog(`Mic permission request: ${result}`);
          }}
        >
          Request Mic Permission
        </button>
      </section>

      <section style={{ marginTop: 16 }}>
        <h2>Audio Source</h2>
        <div>
          <label>
            <input
              type="radio"
              name="source"
              value="mic"
              checked={selectedSource === "mic"}
              onChange={() => setSelectedSource("mic")}
            />{" "}
            Microphone only
          </label>
          <label style={{ marginLeft: 16 }}>
            <input
              type="radio"
              name="source"
              value="system"
              checked={selectedSource === "system"}
              onChange={() => setSelectedSource("system")}
            />{" "}
            System audio only
          </label>
          <label style={{ marginLeft: 16 }}>
            <input
              type="radio"
              name="source"
              value="both"
              checked={selectedSource === "both"}
              onChange={() => setSelectedSource("both")}
            />{" "}
            Both (mixed)
          </label>
        </div>

        {audioDevices.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <label>
              Mic device:{" "}
              <select
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
              >
                <option value="">Default</option>
                {audioDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || d.deviceId.slice(0, 20)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </section>

      <section style={{ marginTop: 16 }}>
        <h2>Recording</h2>
        <div>
          {state === "idle" && <button onClick={startRecording}>Start Recording</button>}
          {state === "recording" && (
            <>
              <button onClick={stopRecording}>Stop Recording</button>
              <span style={{ marginLeft: 16, color: "red" }}>● REC {formatTime(duration)}</span>
            </>
          )}
          {state === "stopped" && (
            <>
              <button
                onClick={() => {
                  setState("idle");
                  setAudioUrl(null);
                }}
              >
                New Recording
              </button>
            </>
          )}
        </div>

        {audioUrl && (
          <div style={{ marginTop: 8 }}>
            <audio controls src={audioUrl} />
          </div>
        )}

        {error && <p style={{ color: "red" }}>{error}</p>}
      </section>

      <section style={{ marginTop: 16 }}>
        <h2>Log</h2>
        <pre
          style={{
            background: "#111",
            color: "#0f0",
            padding: 12,
            maxHeight: 200,
            overflow: "auto",
            fontSize: 12,
          }}
        >
          {log.join("\n")}
        </pre>
      </section>
    </div>
  );
}
