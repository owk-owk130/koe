import { spawn, type ChildProcess } from "child_process";
import { join } from "path";
import { app } from "electron";
import { is } from "@electron-toolkit/utils";
import type { SidecarState } from "~/shared/ipc-channels";
import { getSidecarConfig } from "./settings";

let sidecarProcess: ChildProcess | null = null;
let currentState: SidecarState = { status: "stopped" };
let onStateChange: ((state: SidecarState) => void) | null = null;

function setState(state: SidecarState): void {
  currentState = state;
  onStateChange?.(state);
}

function getSidecarBinaryPath(): string {
  if (is.dev) {
    // dev: use `go run` via the worker package
    return "go";
  }
  const platform = process.platform;
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  return join(process.resourcesPath, "sidecar", `koe-sidecar-${platform}-${arch}`);
}

function getSidecarArgs(): string[] {
  if (is.dev) {
    // dev: go run ./cmd/sidecar
    const workerDir = join(__dirname, "../../../../worker");
    return ["run", join(workerDir, "cmd", "sidecar")];
  }
  return [];
}

function getFFmpegPaths(): { ffmpegPath?: string; ffprobePath?: string } {
  if (is.dev) {
    // dev: use system PATH
    return {};
  }
  return {
    ffmpegPath: join(process.resourcesPath, "ffmpeg", "ffmpeg"),
    ffprobePath: join(process.resourcesPath, "ffmpeg", "ffprobe"),
  };
}

export function setOnStateChange(callback: (state: SidecarState) => void): void {
  onStateChange = callback;
}

export function getSidecarState(): SidecarState {
  return currentState;
}

export async function startSidecar(): Promise<void> {
  if (sidecarProcess) {
    await stopSidecar();
  }

  const { ffmpegPath, ffprobePath } = getFFmpegPaths();
  const config = getSidecarConfig(ffmpegPath, ffprobePath);
  if (!config) {
    setState({ status: "stopped" });
    return;
  }

  setState({ status: "starting" });

  const binaryPath = getSidecarBinaryPath();
  const args = getSidecarArgs();

  try {
    const proc = spawn(binaryPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: is.dev ? { ...process.env } : undefined,
    });

    sidecarProcess = proc;

    // Write config JSON to stdin (keep stdin open for lifecycle monitoring)
    proc.stdin!.write(JSON.stringify(config) + "\n");

    // Read port from stdout
    const port = await readPort(proc);

    // Verify health
    await waitForHealth(port);

    setState({ status: "ready", port });

    // Monitor for unexpected exit
    proc.on("exit", (code) => {
      sidecarProcess = null;
      if (currentState.status === "ready") {
        setState({ status: "error", error: `Sidecar exited unexpectedly (code: ${code})` });
      }
    });

    // Log stderr
    proc.stderr?.on("data", (data: Buffer) => {
      console.log(`[sidecar] ${data.toString().trim()}`);
    });
  } catch (err) {
    sidecarProcess?.kill();
    sidecarProcess = null;
    setState({ status: "error", error: err instanceof Error ? err.message : String(err) });
  }
}

export async function stopSidecar(): Promise<void> {
  if (!sidecarProcess) {
    setState({ status: "stopped" });
    return;
  }

  const proc = sidecarProcess;
  sidecarProcess = null;

  // Close stdin to signal graceful shutdown
  proc.stdin?.end();

  // Wait for exit with timeout
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      resolve();
    }, 5000);

    proc.on("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  setState({ status: "stopped" });
}

export async function restartSidecar(): Promise<void> {
  await stopSidecar();
  await startSidecar();
}

function readPort(proc: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timeout waiting for sidecar port"));
    }, 10000);

    let buffer = "";
    const onData = (data: Buffer) => {
      buffer += data.toString();
      const newlineIdx = buffer.indexOf("\n");
      if (newlineIdx !== -1) {
        proc.stdout?.removeListener("data", onData);
        clearTimeout(timeout);
        try {
          const parsed = JSON.parse(buffer.slice(0, newlineIdx));
          resolve(parsed.port);
        } catch {
          reject(new Error(`Invalid port response: ${buffer}`));
        }
      }
    };

    proc.stdout?.on("data", onData);

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Sidecar exited before reporting port (code: ${code})`));
    });
  });
}

function waitForHealth(port: number, retries = 5): Promise<void> {
  const attempt = (remaining: number): Promise<void> =>
    fetch(`http://127.0.0.1:${port}/health`)
      .then((res) => {
        if (res.ok) return;
        throw new Error(`Health check returned ${res.status}`);
      })
      .catch((_err) => {
        if (remaining <= 1) throw new Error("Sidecar health check failed");
        return new Promise<void>((r) => setTimeout(r, 200)).then(() => attempt(remaining - 1));
      });
  return attempt(retries);
}

export async function processAudio(audioFilePath: string): Promise<unknown> {
  if (currentState.status !== "ready" || !currentState.port) {
    throw new Error("Sidecar is not running");
  }

  const { readFile } = await import("fs/promises");
  const audioData = await readFile(audioFilePath);

  const ext = audioFilePath.split(".").pop()?.toLowerCase() ?? "mp3";
  const contentTypeMap: Record<string, string> = {
    wav: "audio/wav",
    ogg: "audio/ogg",
    flac: "audio/flac",
    m4a: "audio/mp4",
    mp4: "audio/mp4",
    webm: "audio/webm",
    mp3: "audio/mpeg",
  };
  const contentType = contentTypeMap[ext] ?? "audio/mpeg";

  const res = await fetch(`http://127.0.0.1:${currentState.port}/process`, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: audioData,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sidecar processing failed (${res.status}): ${body}`);
  }

  return res.json();
}

// Cleanup on app quit
app.on("before-quit", () => {
  if (sidecarProcess) {
    sidecarProcess.stdin?.end();
    sidecarProcess.kill("SIGTERM");
    sidecarProcess = null;
  }
});
