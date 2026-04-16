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
	return fmt.Sprintf(`以下の音声文字起こしテキストを分析し、全体の要約とトピック分割を行ってください。

## 重要なルール
- summary と detail は自分の言葉で要約すること。文字起こしテキストをそのままコピーしない
- 「〜について話している」「〜が語られる」のような状況説明ではなく、話の具体的な中身を書く
- 誰が何を言ったか、どんな主張・意見・事実が出たかを含める
- 読めばその場にいなくても会話の内容がわかるレベルの具体性が必要

## 出力形式
以下の構造のJSONオブジェクトで返してください:
{
  "summary": "音声全体の要約(2-3文。具体的な内容を含む)",
  "topics": [
    {
      "index": 0,
      "title": "トピックのタイトル(簡潔に)",
      "summary": "トピックの要約(1-2文。具体的な中身を書く)",
      "detail": "トピックの詳細な要約(内容を整理し自分の言葉でまとめる。発言の引用やトランスクリプトのコピーではなく、何が話されたかを段落で説明)",
      "start_sec": 0.0,
      "end_sec": 60.0,
      "transcript": "そのトピックに該当する文字起こしテキスト"
    }
  ]
}

## タイムスタンプ付きセグメント
%s

## 全文テキスト
%s`, segJSON, transcript)
}

// Analyze implements the Analyzer interface.
func (g *GeminiAnalyzer) Analyze(ctx context.Context, transcript string, segments []whisper.Segment) (*AnalysisResult, error) {
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
