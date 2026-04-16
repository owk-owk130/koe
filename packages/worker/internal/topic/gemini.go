package topic

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

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

const analysisSystemInstruction = `あなたは音声会話の構造化分析器です。
目的は、時系列セグメントを漏れなくトピックに分割し、各トピックの内容を具体的に要約することです。

## 優先順位
1. JSONスキーマ準拠
2. トピック境界の正確さ
3. 要約の具体性
4. 不確実な箇所での過剰推測の回避

## トピック分割ルール
- 新しいトピックは、中心論点・意思決定対象・質問・作業フェーズが変わり、その変化が短い脱線ではなく持続するときだけ作る
- 相づち、言い直し、笑い、短い雑談、短い補足、接続表現だけでは分割しない
- 入力全体が1つの話題なら topics は1件にする

## タイムスタンプルール
- 時刻の根拠は segments のみ。start_sec/end_sec は採用した最初と最後の segment の時刻と一致させる
- topics は segments を順番どおりに完全被覆する。欠落・重複・逆転は禁止
- 最初のトピックの start_sec は先頭セグメントの start_sec、最後のトピックの end_sec は末尾セグメントの end_sec と一致させる

## 要約ルール
- summary と detail は自分の言葉で要約する。文字起こしテキストをそのままコピーしない
- 文字起こしに誤字・誤認識があっても、前後の文脈から正しい意味を推測して正確な要約を書く
- 「〜について話している」のような状況説明ではなく、話の具体的な中身を書く
- 結論・決定事項・主張・事実・対立点・未解決事項・次のアクションを優先してまとめる
- 固有名詞・製品名・技術用語はそのまま保持する
- 誤認識の補正は行うが、固有名詞・数値・人名を自信なく断定しない
- 話者が不明なら名前を作らず「参加者」「話者」などで表現する

## transcript フィールド
- transcript は該当する時間範囲のセグメントテキストを元の順で連結したもの（原文保持）
- summary/detail と異なり、transcript では誤認識の補正を行わない

## エッジケース
- 有意味な発話がほぼ無い場合は summary にその旨を書き、topics は空配列にする
- 入力全体が1つの話題なら topics は1件にする
- 途中で切れた会話は、未完であることがわかる要約にする`

func buildUserPrompt(segments []whisper.Segment) string {
	segJSON, _ := json.Marshal(segments)
	return fmt.Sprintf("以下のタイムスタンプ付きセグメントを分析し、全体の要約とトピック分割を行ってください。\n\n%s", segJSON)
}

func analysisResponseSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"summary": map[string]any{
				"type":        "string",
				"description": "音声全体の要約(2-3文。具体的な内容を含む)",
			},
			"topics": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"index":      map[string]any{"type": "integer", "description": "0始まりの連番"},
						"title":      map[string]any{"type": "string", "description": "トピックのタイトル(簡潔に)"},
						"summary":    map[string]any{"type": "string", "description": "トピックの要約(1-2文。具体的な中身を書く)"},
						"detail":     map[string]any{"type": "string", "description": "トピックの詳細な要約(内容を整理し自分の言葉でまとめる)"},
						"start_sec":  map[string]any{"type": "number", "description": "開始時刻(秒)"},
						"end_sec":    map[string]any{"type": "number", "description": "終了時刻(秒)"},
						"transcript": map[string]any{"type": "string", "description": "該当セグメントのテキストを元の順で連結"},
					},
					"required":         []string{"index", "title", "summary", "detail", "start_sec", "end_sec", "transcript"},
					"propertyOrdering": []string{"index", "title", "summary", "detail", "start_sec", "end_sec", "transcript"},
				},
			},
		},
		"required":         []string{"summary", "topics"},
		"propertyOrdering": []string{"summary", "topics"},
	}
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

	return &result, nil
}
