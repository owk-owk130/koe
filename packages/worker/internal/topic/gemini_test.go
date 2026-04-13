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

		// Verify request body has contents
		body, _ := io.ReadAll(r.Body)
		var req geminiRequest
		if err := json.Unmarshal(body, &req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if len(req.Contents) == 0 {
			t.Fatal("expected non-empty contents")
		}

		// Respond with Gemini format containing JSON topics
		topics := []Topic{
			{Index: 0, Title: "挨拶", Summary: "挨拶の場面", StartSec: 0, EndSec: 30, Transcript: "こんにちは"},
			{Index: 1, Title: "本題", Summary: "本題の議論", StartSec: 30, EndSec: 120, Transcript: "今日は天気について話しましょう"},
		}
		topicsJSON, _ := json.Marshal(topics)

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

	topics, err := analyzer.Analyze(context.Background(), "こんにちは\n今日は天気について話しましょう", segments)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(topics) != 2 {
		t.Fatalf("expected 2 topics, got %d", len(topics))
	}
	if topics[0].Title != "挨拶" {
		t.Errorf("topics[0].Title = %q, want '挨拶'", topics[0].Title)
	}
	if topics[1].StartSec != 30 {
		t.Errorf("topics[1].StartSec = %f, want 30", topics[1].StartSec)
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
		resp := geminiResponse{
			Candidates: []geminiCandidate{{
				Content: geminiContent{
					Parts: []geminiPart{{Text: "[]"}},
				},
			}},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	analyzer := &GeminiAnalyzer{APIKey: "key", BaseURL: srv.URL, Model: "gemini-2.0-flash-lite"}
	topics, err := analyzer.Analyze(context.Background(), "short text", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(topics) != 0 {
		t.Errorf("expected 0 topics, got %d", len(topics))
	}
}
