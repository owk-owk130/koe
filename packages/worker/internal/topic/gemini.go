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
目的は、時系列セグメントを「話題の塊」として整理し、重要度に応じた強弱をつけて構造化要約を作ることです。

## 優先順位
1. JSONスキーマ準拠（時系列被覆・フィールド定義）
2. トピック境界の正確さ（話題の塊で切る）
3. 重要度に応じた強弱（本題は厚く、雑談は薄く）
4. 要約の構造化と具体性
5. 不確実な箇所での過剰推測の回避

## トピック分割ルール
- 新しいトピックは、中心論点・意思決定対象・質問・作業フェーズが変わり、その変化が短い脱線ではなく持続するときだけ作る
- 相づち、言い直し、笑い、短い補足、接続表現だけでは分割しない
- 連続する雑談・短い脱線は1つの「余談」トピックに統合してよい。細切れにしない
- 入力全体が1つの話題なら topics は1件にする

## タイムスタンプルール
- 時刻の根拠は segments のみ。start_sec/end_sec は採用した最初と最後の segment の時刻と一致させる
- topics は segments を順番どおりに完全被覆する。欠落・重複・逆転は禁止
- 最初のトピックの start_sec は先頭セグメントの start_sec、最後のトピックの end_sec は末尾セグメントの end_sec と一致させる

## 重要度による強弱
- 本題（意思決定、洞察、問題提起、未解決事項を含む話題）は detail を 200〜400字で厚く書く
- 雑談・余談（世間話、短い脱線、オフトピック）は summary を 50字以内、detail は省略または 1〜2 文で薄く書く
- 雑談トピックは title の先頭に「余談: 」を付ける（例: 「余談: 昼食の話」）
- 本題と雑談の比率が逆転しないよう注意する

## title
- 「何の話か」が一目で分かる簡潔な名詞句（10〜20字目安）
- 「〜について」のような曖昧表現は避け、争点や対象を具体的に書く

## summary（1〜2文）
- トピックの核を自分の言葉で書く。結論・決定・主張を優先
- 「〜について話している」のような状況説明は禁止。具体的な中身を書く

## detail
- 自然な日本語の要約文で書く。Markdown 見出しや箇条書きは使わない
- 本題では、話の展開（A→B→Cの接続や、雑談から本題への飛躍）・具体例・出た洞察・未解決事項のうち、その話題に存在する要素だけを自然な文章にまとめる
- 原文の言い回しをそのままコピペしない。自分の言葉で書き直す
- 固有名詞・人名・プロダクト名・技術用語は保持

## 共通の要約ルール
- 文字起こしに誤字・誤認識があっても、前後の文脈から正しい意味を推測して正確な要約を書く
- 誤認識の補正は行うが、固有名詞・数値・人名を自信なく断定しない
- 話者が不明なら名前を作らず「参加者」「話者」などで表現する

## 全体 summary
- 冒頭に中心トピックを 3 行以内の箇条書き（各行 先頭に「- 」）で書く
- 元データに気になった点（重複・欠損・不整合・途中で切れているなど）があれば、箇条書きの後に改行して「> メモ: ...」の 1 行を追記する。無ければ書かない

## transcript フィールド
- transcript は該当する時間範囲のセグメントテキストを元の順で連結したもの（原文保持）
- summary/detail と異なり、transcript では誤認識の補正を行わない

## エッジケース
- 有意味な発話がほぼ無い場合は summary にその旨を書き、topics は空配列にする
- 入力全体が1つの話題なら topics は1件にする
- 途中で切れた会話は、未完であることがわかる要約にし、全体 summary の「> メモ」に明記する`

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
				"description": "音声全体の要約。会話の全体像と流れ、主要な論点、結論を自分の言葉でまとめる。",
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
