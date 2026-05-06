// Workers TS から Gemini を直接呼ぶ。元々 Go コンテナの
// internal/topic/gemini.go にあった処理を Workers 側に移管した形で、
// Container は ffmpeg + Whisper だけになる。

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";

export interface Segment {
  text: string;
  start_sec: number;
  end_sec: number;
}

export interface AnalyzedTopic {
  index: number;
  title: string;
  summary: string;
  detail: string;
  start_sec: number;
  end_sec: number;
  transcript: string;
}

export interface AnalyzeResult {
  summary: string;
  topics: AnalyzedTopic[];
}

export interface GeminiAnalyzerOptions {
  apiKey: string;
  model: string;
  baseURL?: string;
}

const ANALYSIS_SYSTEM_INSTRUCTION = `あなたは会議録の要約者です。
目的は、(1) 会議全体のまとめ と (2) 議論された主要トピック を、読み手がすぐ把握できる形でまとめることです。
時刻情報は補助情報であり、精度は重視しません。

## 大方針
- 出力は「会議全体の要約」と「主要トピックの要約」の 2 軸。それ以外は要らない
- 雑談・相槌・繰り返し発話・終了挨拶・無音時の幻覚 (例: 「ご視聴ありがとうございました」「はい」「ん」「あ」の連発) はトピック化しない。完全に無視する
- 「余談」というトピック名も作らない。本題だけ抽出する

## 全体 summary
- 5〜10 行の自然な日本語で、何が話されたか・何が決まったか・未解決事項を網羅する
- 文章のあと、必要に応じて「> メモ:」で気づきを 1〜2 行（例: 雑談多め / 機材トラブルで一部不明瞭 / 結論未到達 など）。無ければ書かない
- 「〜について話している」のような状況説明は禁止。具体的な中身を書く

## topics（5〜10 件、最大 15 件）
- 30 秒以上、意味のある議論・決定・問題提起・未解決事項を含むものだけ
- 数を絞ること。同じ話題は前後で 1 つに統合する
- 雑談・相槌・終了挨拶・短い脱線・hallucination 風の繰り返しはトピック化しない（無視する）
- 入力全体が 1 つの話題なら topics は 1 件で十分

## 各 topic フィールド
- title: 一目で分かる簡潔な名詞句（10〜20 字）。「〜について」のような曖昧表現は避ける
- summary: 1〜2 文で結論や争点。状況説明 ("〜について話している") は禁止
- detail: 200〜400 字の自然な日本語。話の展開・具体例・出た洞察・未解決事項のうち、その話題に存在する要素だけを書く。Markdown 見出し・箇条書きは使わない
- start_sec / end_sec: 最寄りセグメントの時刻でよい。精度は緩くてよい

## 共通ルール
- 原文の言い回しをそのままコピペしない。自分の言葉で書き直す
- 固有名詞・人名・プロダクト名・技術用語は保持する
- 誤認識の補正は文脈で行うが、固有名詞・数値・人名は自信なく断定しない
- 話者が不明なら名前を作らず「参加者」「話者」などで表現する

## エッジケース
- 有意味な発話がほぼ無い場合: summary にその旨を書き、topics は空配列にする
- 途中で切れた会話: 未完であることがわかる要約にし、summary の「> メモ」に明記する`;

// 会議が長くなると topics が積み上がるので、デフォルト 8192 では JSON が
// 途中で切れる。Gemini 2.x Flash の上限近くまで広げて事故耐性を上げる。
const MAX_OUTPUT_TOKENS = 32768;

// Gemini が返すべきフィールドだけを定義。transcript はサーバ側で再構築する
// ので入れない。これにより出力トークンが膨らんで JSON が途中で切れる事故も
// 同時に避けられる。
const responseSchema = () => ({
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "音声全体の要約。会話の全体像と流れ、主要な論点、結論を自分の言葉でまとめる。",
    },
    topics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", description: "0始まりの連番" },
          title: { type: "string", description: "トピックのタイトル(簡潔に)" },
          summary: { type: "string", description: "トピックの要約(1-2文。具体的な中身を書く)" },
          detail: {
            type: "string",
            description: "トピックの詳細な要約(内容を整理し自分の言葉でまとめる)",
          },
          start_sec: { type: "number", description: "開始時刻(秒)" },
          end_sec: { type: "number", description: "終了時刻(秒)" },
        },
        required: ["index", "title", "summary", "detail", "start_sec", "end_sec"],
        propertyOrdering: ["index", "title", "summary", "detail", "start_sec", "end_sec"],
      },
    },
  },
  required: ["summary", "topics"],
  propertyOrdering: ["summary", "topics"],
});

const buildUserPrompt = (segments: Segment[]): string =>
  `以下のタイムスタンプ付きセグメントを分析し、全体の要約とトピック分割を行ってください。\n\n${JSON.stringify(segments)}`;

// transcript を [startSec, endSec) 内の segment.text で連結する。
// segment 開始時刻を基準にしているので、隣接トピックの境界 (前のトピックの
// end_sec === 次のトピックの start_sec) で同じセグメントが両方に入る race を防げる。
const transcriptForRange = (segments: Segment[], startSec: number, endSec: number): string =>
  segments
    .filter((s) => s.start_sec >= startSec && s.start_sec < endSec)
    .map((s) => s.text)
    .join("\n");

export const analyzeWithGemini = async (
  segments: Segment[],
  opts: GeminiAnalyzerOptions,
): Promise<AnalyzeResult> => {
  const baseURL = opts.baseURL ?? DEFAULT_BASE_URL;
  const url = `${baseURL}/v1beta/models/${opts.model}:generateContent`;

  const reqBody = {
    system_instruction: { parts: [{ text: ANALYSIS_SYSTEM_INSTRUCTION }] },
    contents: [{ parts: [{ text: buildUserPrompt(segments) }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: responseSchema(),
      temperature: 0.2,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": opts.apiKey,
    },
    body: JSON.stringify(reqBody),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`gemini API error (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text: string }[] } }[];
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("empty response from Gemini");
  }

  type ParsedTopic = Omit<AnalyzedTopic, "transcript">;
  let parsed: { summary: string; topics: ParsedTopic[] };
  try {
    parsed = JSON.parse(text) as { summary: string; topics: ParsedTopic[] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`parse analysis JSON: ${message} (raw: ${text})`, { cause: err });
  }

  return {
    summary: parsed.summary,
    topics: parsed.topics.map((t) => ({
      ...t,
      transcript: transcriptForRange(segments, t.start_sec, t.end_sec),
    })),
  };
};
