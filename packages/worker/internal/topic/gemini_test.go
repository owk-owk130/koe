package topic

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
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

		// Verify request body has contents and generationConfig
		body, _ := io.ReadAll(r.Body)
		var req geminiRequest
		if err := json.Unmarshal(body, &req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if len(req.Contents) == 0 {
			t.Fatal("expected non-empty contents")
		}
		if req.GenerationConfig.ResponseMimeType != "application/json" {
			t.Errorf("expected responseMimeType 'application/json', got %q", req.GenerationConfig.ResponseMimeType)
		}

		// Respond with Gemini format containing JSON analysis result
		analysisResult := AnalysisResult{
			Summary: "挨拶から始まり、天気について議論する会話。",
			Topics: []Topic{
				{Index: 0, Title: "挨拶", Summary: "挨拶の場面", Detail: "会話の冒頭で参加者が挨拶を交わしている場面。", StartSec: 0, EndSec: 30, Transcript: "こんにちは"},
				{Index: 1, Title: "本題", Summary: "本題の議論", Detail: "天気について話し合う本題に入り、今日の天気予報や週末の天候について意見を交換している。", StartSec: 30, EndSec: 120, Transcript: "今日は天気について話しましょう"},
			},
		}
		topicsJSON, _ := json.Marshal(analysisResult)

		resp := geminiResponse{
			Candidates: []geminiCandidate{{
				Content: geminiContent{
					Parts: []geminiPart{{Text: string(topicsJSON)}},
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
		{Text: "こんにちは", StartSec: 0, EndSec: 30},
		{Text: "今日は天気について話しましょう", StartSec: 30, EndSec: 120},
	}

	result, err := analyzer.Analyze(context.Background(), "こんにちは\n今日は天気について話しましょう", segments)
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
	if result.Topics[0].Detail == "" {
		t.Error("expected non-empty detail for topics[0]")
	}
	if result.Topics[1].StartSec != 30 {
		t.Errorf("topics[1].StartSec = %f, want 30", result.Topics[1].StartSec)
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
