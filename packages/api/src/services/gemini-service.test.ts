import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeWithGemini, type Segment } from "./gemini-service";

const segments: Segment[] = [
  { text: "こんにちは", start_sec: 0, end_sec: 5 },
  { text: "おはようございます", start_sec: 5, end_sec: 10 },
  { text: "今日は天気の話", start_sec: 30, end_sec: 60 },
  { text: "明日も晴れるそうです", start_sec: 60, end_sec: 90 },
];

const fakeModelOutput = {
  summary: "挨拶と天気の話。",
  topics: [
    {
      index: 0,
      title: "挨拶",
      summary: "挨拶を交わした。",
      detail: "二人が挨拶を交わしている。",
      start_sec: 0,
      end_sec: 30,
    },
    {
      index: 1,
      title: "天気",
      summary: "天気について話している。",
      detail: "明日の天気予報について意見を交換した。",
      start_sec: 30,
      end_sec: 90,
    },
  ],
};

const mockFetchOk = (modelOutput: unknown = fakeModelOutput) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: { parts: [{ text: JSON.stringify(modelOutput) }] },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe("analyzeWithGemini", () => {
  it("posts to the configured Gemini model with the analysis prompt and schema", async () => {
    const fetchMock = mockFetchOk();

    await analyzeWithGemini(segments, {
      apiKey: "test-key",
      model: "gemini-2.5-flash",
      baseURL: "https://generativelanguage.example",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    if (!init) throw new Error("fetch was called without init options");
    expect(url).toBe(
      "https://generativelanguage.example/v1beta/models/gemini-2.5-flash:generateContent",
    );
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");

    const body = JSON.parse(init.body as string);
    expect(body.system_instruction.parts[0].text).toContain("会議録");
    // transcript は LLM 出力からは外してあるので prompt にもスキーマにも残らない
    expect(body.system_instruction.parts[0].text).not.toContain("transcript");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(16000);
    const topicProps = body.generationConfig.responseSchema.properties.topics.items.properties;
    expect("transcript" in topicProps).toBe(false);
  });

  it("rebuilds each topic.transcript server-side from segments", async () => {
    mockFetchOk();

    const result = await analyzeWithGemini(segments, {
      apiKey: "k",
      model: "gemini-2.5-flash",
    });

    expect(result.summary).toBe("挨拶と天気の話。");
    expect(result.topics).toHaveLength(2);
    expect(result.topics[0].transcript).toBe("こんにちは\nおはようございます");
    expect(result.topics[1].transcript).toBe("今日は天気の話\n明日も晴れるそうです");
  });

  it("throws when Gemini returns non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("rate limited", { status: 429 }));

    await expect(
      analyzeWithGemini(segments, { apiKey: "k", model: "gemini-2.5-flash" }),
    ).rejects.toThrow(/gemini API error.*429/);
  });

  it("throws when the response JSON cannot be parsed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "{not json" }] } }],
        }),
        { status: 200 },
      ),
    );

    await expect(
      analyzeWithGemini(segments, { apiKey: "k", model: "gemini-2.5-flash" }),
    ).rejects.toThrow(/parse analysis JSON/);
  });

  it("throws when Gemini returns an empty candidate set", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
    );

    await expect(
      analyzeWithGemini(segments, { apiKey: "k", model: "gemini-2.5-flash" }),
    ).rejects.toThrow(/empty response/);
  });
});
