// Workers AI Whisper を REST API 経由で直接呼ぶサービス。
// Go コンテナ (packages/worker) から TS に移植したもの。base URL を AI Gateway
// に向ければ gateway 経由のメトリクス・キャッシュも引き続き使える。
//
// Hallucination guards:
//  - vad_filter は Workers AI 既定 false → koe では true
//  - condition_on_previous_text は既定 true → koe では false
// 長尺・無音混じりの音声で「はい\nはい\n…」のループを抑えるための koe 既定値。

export interface WhisperSegment {
  text: string;
  start_sec: number;
  end_sec: number;
}

export interface WhisperTranscript {
  text: string;
  segments: WhisperSegment[];
}

export interface WhisperOptions {
  baseURL: string;
  apiKey: string;
  model: string;
  language?: string;
  vadFilter?: boolean;
  conditionOnPreviousText?: boolean;
  compressionRatioThreshold?: number;
  noSpeechThreshold?: number;
  hallucinationSilenceThreshold?: number;
  initialPrompt?: string;
}

interface WorkersAISegment {
  text: string;
  start: number;
  end: number;
}

interface WorkersAIResult {
  text: string;
  segments?: WorkersAISegment[];
}

interface WorkersAIResponse {
  success: boolean;
  result?: WorkersAIResult;
  errors?: { code: number; message: string }[];
}

export const transcribeChunk = async (
  audio: Uint8Array,
  opts: WhisperOptions,
): Promise<WhisperTranscript> => {
  const url = `${opts.baseURL}/run/${opts.model}`;
  const payload = buildPayload(audio, opts);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
      "cf-aig-authorization": `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`whisper API error (${response.status}): ${text}`);
  }

  const data = (await response.json()) as WorkersAIResponse;
  if (!data.success) {
    const messages = (data.errors ?? []).map((e) => e.message).join("; ");
    throw new Error(`workers AI error: ${messages || "unknown"}`);
  }

  const result = data.result ?? { text: "", segments: [] };
  return {
    text: result.text,
    segments: (result.segments ?? []).map((s) => ({
      text: s.text,
      start_sec: s.start,
      end_sec: s.end,
    })),
  };
};

const buildPayload = (audio: Uint8Array, opts: WhisperOptions): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    audio: encodeBase64(audio),
    task: "transcribe",
    language: opts.language ?? "ja",
    vad_filter: opts.vadFilter ?? true,
    condition_on_previous_text: opts.conditionOnPreviousText ?? false,
  };
  if (opts.compressionRatioThreshold !== undefined) {
    payload.compression_ratio_threshold = opts.compressionRatioThreshold;
  }
  if (opts.noSpeechThreshold !== undefined) {
    payload.no_speech_threshold = opts.noSpeechThreshold;
  }
  if (opts.hallucinationSilenceThreshold !== undefined) {
    payload.hallucination_silence_threshold = opts.hallucinationSilenceThreshold;
  }
  if (opts.initialPrompt !== undefined) {
    payload.initial_prompt = opts.initialPrompt;
  }
  return payload;
};

const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
};
