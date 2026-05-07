import { afterEach, describe, expect, it, vi } from "vitest";
import { transcribeChunk } from "./whisper-service";

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const workersAIOk = (text: string, segments: { text: string; start: number; end: number }[]) =>
  ok({ success: true, result: { text, segments } });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("transcribeChunk", () => {
  it("posts base64-encoded audio to the Workers AI run endpoint with hallucination guards", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(workersAIOk("hello", [{ text: "hello", start: 0, end: 1 }]));

    const audio = new Uint8Array([1, 2, 3, 4]);
    await transcribeChunk(audio, {
      baseURL: "https://gateway.example",
      apiKey: "key123",
      model: "@cf/openai/whisper-large-v3-turbo",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    if (!init) throw new Error("fetch called without init");
    expect(url).toBe("https://gateway.example/run/@cf/openai/whisper-large-v3-turbo");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer key123");
    expect(headers["cf-aig-authorization"]).toBe("Bearer key123");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string);
    expect(body.audio).toBe(btoa(String.fromCharCode(...audio)));
    expect(body.task).toBe("transcribe");
    expect(body.language).toBe("ja");
    expect(body.vad_filter).toBe(true);
    expect(body.condition_on_previous_text).toBe(false);
  });

  it("returns chunk-local text and segments mapped to camelCase fields", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      workersAIOk("hello world", [
        { text: "hello ", start: 0, end: 1.5 },
        { text: "world", start: 1.5, end: 3 },
      ]),
    );

    const result = await transcribeChunk(new Uint8Array([0]), {
      baseURL: "https://x",
      apiKey: "k",
      model: "@cf/openai/whisper-large-v3-turbo",
    });

    expect(result.text).toBe("hello world");
    expect(result.segments).toEqual([
      { text: "hello ", start_sec: 0, end_sec: 1.5 },
      { text: "world", start_sec: 1.5, end_sec: 3 },
    ]);
  });

  it("forwards optional knobs and respects overridden hallucination guards", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(workersAIOk("ok", []));

    await transcribeChunk(new Uint8Array([0]), {
      baseURL: "https://x",
      apiKey: "k",
      model: "@cf/openai/whisper-large-v3-turbo",
      language: "en",
      vadFilter: false,
      conditionOnPreviousText: true,
      compressionRatioThreshold: 1.8,
      noSpeechThreshold: 0.4,
      hallucinationSilenceThreshold: 2,
      initialPrompt: "context",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.language).toBe("en");
    expect(body.vad_filter).toBe(false);
    expect(body.condition_on_previous_text).toBe(true);
    expect(body.compression_ratio_threshold).toBe(1.8);
    expect(body.no_speech_threshold).toBe(0.4);
    expect(body.hallucination_silence_threshold).toBe(2);
    expect(body.initial_prompt).toBe("context");
  });

  it("throws on non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));

    await expect(
      transcribeChunk(new Uint8Array([0]), {
        baseURL: "https://x",
        apiKey: "k",
        model: "@cf/openai/whisper-large-v3-turbo",
      }),
    ).rejects.toThrow(/whisper API error.*500/);
  });

  it("throws on success=false from Workers AI", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ok({ success: false, errors: [{ code: 8001, message: "Invalid input" }] }),
    );

    await expect(
      transcribeChunk(new Uint8Array([0]), {
        baseURL: "https://x",
        apiKey: "k",
        model: "@cf/openai/whisper-large-v3-turbo",
      }),
    ).rejects.toThrow(/Invalid input/);
  });
});
