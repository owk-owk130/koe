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
	Contents         []geminiContent  `json:"contents"`
	GenerationConfig generationConfig `json:"generationConfig"`
}

type generationConfig struct {
	ResponseMimeType string `json:"responseMimeType"`
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

func buildPrompt(transcript string, segments []whisper.Segment) string {
	segJSON, _ := json.Marshal(segments)
	return fmt.Sprintf(`以下の音声文字起こしテキストをトピックごとに分割してください。

各トピックについて以下の情報をJSON配列で返してください:
- index: トピックの通し番号(0始まり)
- title: トピックのタイトル(簡潔に)
- summary: トピックの要約(1-2文)
- start_sec: 開始時刻(秒)
- end_sec: 終了時刻(秒)
- transcript: そのトピックに該当する文字起こしテキスト

## タイムスタンプ付きセグメント
%s

## 全文テキスト
%s`, segJSON, transcript)
}

// Analyze implements the Analyzer interface.
func (g *GeminiAnalyzer) Analyze(ctx context.Context, transcript string, segments []whisper.Segment) ([]Topic, error) {
	prompt := buildPrompt(transcript, segments)

	reqBody := geminiRequest{
		Contents: []geminiContent{{
			Parts: []geminiPart{{Text: prompt}},
		}},
		GenerationConfig: generationConfig{
			ResponseMimeType: "application/json",
		},
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	url := fmt.Sprintf("%s/v1beta/models/%s:generateContent?key=%s", g.baseURL(), g.Model, g.APIKey)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

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

	var topics []Topic
	if err := json.Unmarshal([]byte(text), &topics); err != nil {
		return nil, fmt.Errorf("parse topics JSON: %w (raw: %s)", err, text)
	}

	return topics, nil
}
