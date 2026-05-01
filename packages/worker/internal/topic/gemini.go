package topic

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/owk-owk130/koe/packages/worker/internal/whisper"
)

const defaultGeminiBaseURL = "https://generativelanguage.googleapis.com"

// GeminiAnalyzer uses the Gemini API to split transcripts into topics.
type GeminiAnalyzer struct {
	APIKey     string
	BaseURL    string
	Model      string
	HTTPClient *http.Client
}

// Gemini API request/response types.

type geminiRequest struct {
	SystemInstruction *geminiContent   `json:"system_instruction,omitempty"`
	Contents          []geminiContent  `json:"contents"`
	GenerationConfig  generationConfig `json:"generationConfig"`
}

type generationConfig struct {
	ResponseMimeType string         `json:"responseMimeType"`
	ResponseSchema   map[string]any `json:"responseSchema,omitempty"`
	Temperature      *float64       `json:"temperature,omitempty"`
	MaxOutputTokens  int            `json:"maxOutputTokens,omitempty"`
}

type geminiContent struct {
	Parts []geminiPart `json:"parts"`
}

type geminiPart struct {
	Text string `json:"text"`
}

type geminiResponse struct {
	Candidates []geminiCandidate `json:"candidates"`
}

type geminiCandidate struct {
	Content geminiContent `json:"content"`
}

func (g *GeminiAnalyzer) httpClient() *http.Client {
	if g.HTTPClient != nil {
		return g.HTTPClient
	}
	return http.DefaultClient
}

func (g *GeminiAnalyzer) baseURL() string {
	if g.BaseURL != "" {
		return g.BaseURL
	}
	return defaultGeminiBaseURL
}

const analysisSystemInstruction = `あなたは会議録の要約者です。
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
- 途中で切れた会話: 未完であることがわかる要約にし、summary の「> メモ」に明記する`

func buildUserPrompt(segments []whisper.Segment) string {
	segJSON, _ := json.Marshal(segments)
	return fmt.Sprintf("以下のタイムスタンプ付きセグメントを分析し、全体の要約とトピック分割を行ってください。\n\n%s", segJSON)
}

// analysisResponseSchema asks Gemini for boundaries only. The transcript field
// is intentionally absent: making the LLM re-emit raw audio inflates output
// tokens and triggered repeated JSON truncation / escape failures (Whisper
// hallucination loops were copied verbatim into the response). The server
// reconstructs each topic's transcript from segments after parsing.
func analysisResponseSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"summary": map[string]any{
				"type":        "string",
				"description": "音声全体の要約。会話の全体像と流れ、主要な論点、結論を自分の言葉でまとめる。",
			},
			"topics": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"index":     map[string]any{"type": "integer", "description": "0始まりの連番"},
						"title":     map[string]any{"type": "string", "description": "トピックのタイトル(簡潔に)"},
						"summary":   map[string]any{"type": "string", "description": "トピックの要約(1-2文。具体的な中身を書く)"},
						"detail":    map[string]any{"type": "string", "description": "トピックの詳細な要約(内容を整理し自分の言葉でまとめる)"},
						"start_sec": map[string]any{"type": "number", "description": "開始時刻(秒)"},
						"end_sec":   map[string]any{"type": "number", "description": "終了時刻(秒)"},
					},
					"required":         []string{"index", "title", "summary", "detail", "start_sec", "end_sec"},
					"propertyOrdering": []string{"index", "title", "summary", "detail", "start_sec", "end_sec"},
				},
			},
		},
		"required":         []string{"summary", "topics"},
		"propertyOrdering": []string{"summary", "topics"},
	}
}

// transcriptForRange returns the original segment text concatenated by newlines
// for segments whose start time falls within [startSec, endSec). Using the
// segment start (not midpoint) keeps the output stable when topic boundaries
// align with segment boundaries, which the LLM is told to do.
func transcriptForRange(segments []whisper.Segment, startSec, endSec float64) string {
	var lines []string
	for _, s := range segments {
		if s.StartSec >= startSec && s.StartSec < endSec {
			lines = append(lines, s.Text)
		}
	}
	return strings.Join(lines, "\n")
}

// Analyze implements the Analyzer interface.
func (g *GeminiAnalyzer) Analyze(ctx context.Context, transcript string, segments []whisper.Segment) (*AnalysisResult, error) {
	prompt := buildUserPrompt(segments)
	temp := 0.2

	reqBody := geminiRequest{
		SystemInstruction: &geminiContent{
			Parts: []geminiPart{{Text: analysisSystemInstruction}},
		},
		Contents: []geminiContent{{
			Parts: []geminiPart{{Text: prompt}},
		}},
		GenerationConfig: generationConfig{
			ResponseMimeType: "application/json",
			ResponseSchema:   analysisResponseSchema(),
			Temperature:      &temp,
			// Long meetings produce many topics, and each topic carries its own
			// summary + 200-400 character detail string. The default 8192 cap
			// truncates the JSON mid-array ("unexpected end of JSON input"), so
			// raise the ceiling near the model's hard limit.
			MaxOutputTokens: 32768,
		},
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	url := fmt.Sprintf("%s/v1beta/models/%s:generateContent", g.baseURL(), g.Model)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", g.APIKey)

	resp, err := g.httpClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("gemini API error (status %d): %s", resp.StatusCode, body)
	}

	var geminiResp geminiResponse
	if err := json.NewDecoder(resp.Body).Decode(&geminiResp); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	if len(geminiResp.Candidates) == 0 || len(geminiResp.Candidates[0].Content.Parts) == 0 {
		return nil, fmt.Errorf("empty response from Gemini")
	}

	text := geminiResp.Candidates[0].Content.Parts[0].Text

	var result AnalysisResult
	if err := json.Unmarshal([]byte(text), &result); err != nil {
		return nil, fmt.Errorf("parse analysis JSON: %w (raw: %s)", err, text)
	}

	for i := range result.Topics {
		t := &result.Topics[i]
		t.Transcript = transcriptForRange(segments, t.StartSec, t.EndSec)
	}

	return &result, nil
}
