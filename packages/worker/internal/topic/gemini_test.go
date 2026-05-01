package topic

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/owk-owk130/koe/packages/worker/internal/whisper"
)

func TestGeminiAnalyzer_Analyze(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}

		// Verify API key is in header, not in URL query
		if apiKey := r.Header.Get("x-goog-api-key"); apiKey != "test-key" {
			t.Errorf("expected x-goog-api-key 'test-key', got %q", apiKey)
		}
		if r.URL.RawQuery != "" {
			t.Errorf("expected no query params (API key should be in header), got %q", r.URL.RawQuery)
		}

		body, _ := io.ReadAll(r.Body)
		var req geminiRequest
		if err := json.Unmarshal(body, &req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if req.SystemInstruction == nil || len(req.SystemInstruction.Parts) == 0 {
			t.Fatal("expected non-empty system_instruction")
		}
		// transcript must not appear in the system prompt. We rebuild it
		// server-side so the LLM never re-emits hallucinated audio.
		if strings.Contains(req.SystemInstruction.Parts[0].Text, "transcript") {
			t.Error("system instruction must not mention 'transcript'")
		}
		if len(req.Contents) == 0 {
			t.Fatal("expected non-empty contents")
		}
		if req.GenerationConfig.ResponseMimeType != "application/json" {
			t.Errorf("expected responseMimeType 'application/json', got %q", req.GenerationConfig.ResponseMimeType)
		}
		if req.GenerationConfig.ResponseSchema == nil {
			t.Fatal("expected non-nil responseSchema")
		}
		// transcript must not appear in the response schema either.
		topicSchema := req.GenerationConfig.ResponseSchema["properties"].(map[string]any)["topics"].(map[string]any)["items"].(map[string]any)
		topicProps := topicSchema["properties"].(map[string]any)
		if _, exists := topicProps["transcript"]; exists {
			t.Error("response schema topic must not include 'transcript' field")
		}
		if req.GenerationConfig.Temperature == nil || *req.GenerationConfig.Temperature != 0.2 {
			t.Error("expected temperature 0.2")
		}
		// Long meetings need a high cap to avoid mid-array JSON truncation.
		if req.GenerationConfig.MaxOutputTokens < 16000 {
			t.Errorf(
				"expected MaxOutputTokens >= 16000, got %d",
				req.GenerationConfig.MaxOutputTokens,
			)
		}

		// Gemini returns topics WITHOUT transcript — the boundary-only contract.
		modelOutput := map[string]any{
			"summary": "挨拶から始まり、天気について議論する会話。",
			"topics": []map[string]any{
				{"index": 0, "title": "挨拶", "summary": "挨拶の場面", "detail": "会話の冒頭で参加者が挨拶を交わしている場面。", "start_sec": 0, "end_sec": 30},
				{"index": 1, "title": "本題", "summary": "本題の議論", "detail": "天気について話し合う本題に入り、今日の天気予報や週末の天候について意見を交換している。", "start_sec": 30, "end_sec": 120},
			},
		}
		out, _ := json.Marshal(modelOutput)

		resp := geminiResponse{
			Candidates: []geminiCandidate{{
				Content: geminiContent{
					Parts: []geminiPart{{Text: string(out)}},
				},
			}},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	analyzer := &GeminiAnalyzer{
		APIKey:  "test-key",
		BaseURL: srv.URL,
		Model:   "gemini-2.0-flash-lite",
	}

	segments := []whisper.Segment{
		{Text: "こんにちは", StartSec: 0, EndSec: 5},
		{Text: "おはようございます", StartSec: 5, EndSec: 10},
		{Text: "今日は天気について話しましょう", StartSec: 30, EndSec: 60},
		{Text: "明日も晴れるそうですね", StartSec: 60, EndSec: 90},
	}

	result, err := analyzer.Analyze(context.Background(), "fullText is unused", segments)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Summary == "" {
		t.Error("expected non-empty summary")
	}
	if len(result.Topics) != 2 {
		t.Fatalf("expected 2 topics, got %d", len(result.Topics))
	}
	if result.Topics[0].Title != "挨拶" {
		t.Errorf("topics[0].Title = %q, want '挨拶'", result.Topics[0].Title)
	}

	// Topic.Transcript must be reconstructed server-side from segments.
	if got, want := result.Topics[0].Transcript, "こんにちは\nおはようございます"; got != want {
		t.Errorf("topics[0].Transcript = %q, want %q", got, want)
	}
	if got, want := result.Topics[1].Transcript, "今日は天気について話しましょう\n明日も晴れるそうですね"; got != want {
		t.Errorf("topics[1].Transcript = %q, want %q", got, want)
	}
}

func TestGeminiAnalyzer_Analyze_APIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"error": {"message": "forbidden"}}`))
	}))
	defer srv.Close()

	analyzer := &GeminiAnalyzer{
		APIKey:  "bad-key",
		BaseURL: srv.URL,
		Model:   "gemini-2.0-flash-lite",
	}

	_, err := analyzer.Analyze(context.Background(), "text", nil)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestGeminiAnalyzer_Analyze_EmptyResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		result := AnalysisResult{
			Summary: "短いテキスト。",
			Topics:  []Topic{},
		}
		resultJSON, _ := json.Marshal(result)
		resp := geminiResponse{
			Candidates: []geminiCandidate{{
				Content: geminiContent{
					Parts: []geminiPart{{Text: string(resultJSON)}},
				},
			}},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	analyzer := &GeminiAnalyzer{APIKey: "key", BaseURL: srv.URL, Model: "gemini-2.0-flash-lite"}
	result, err := analyzer.Analyze(context.Background(), "short text", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result.Topics) != 0 {
		t.Errorf("expected 0 topics, got %d", len(result.Topics))
	}
}
