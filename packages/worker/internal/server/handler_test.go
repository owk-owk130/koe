package server

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/owk-owk130/koe/packages/worker/internal/pipeline"
	"github.com/owk-owk130/koe/packages/worker/internal/topic"
	"github.com/owk-owk130/koe/packages/worker/internal/whisper"
)

type mockRunner struct {
	result *pipeline.Result
	err    error
}

func (m *mockRunner) Run(_ context.Context, _ pipeline.Input) (*pipeline.Result, error) {
	return m.result, m.err
}

func TestHealthHandler(t *testing.T) {
	h := &Handler{Runner: &mockRunner{}}
	srv := httptest.NewServer(h.Mux())
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/health")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	if string(body) != `{"status":"ok"}` {
		t.Errorf("unexpected body: %s", body)
	}
}

func TestProcessHandler_Success(t *testing.T) {
	runner := &mockRunner{
		result: &pipeline.Result{
			Transcript: whisper.Transcript{
				Text:     "hello world",
				Segments: []whisper.Segment{{Text: "hello world", StartSec: 0, EndSec: 10}},
			},
			Topics: []topic.Topic{
				{Index: 0, Title: "Greeting", StartSec: 0, EndSec: 10},
			},
			Chunks: []pipeline.ChunkResult{
				{Index: 0, StartSec: 0, EndSec: 10, Text: "hello world"},
			},
		},
	}

	h := &Handler{Runner: runner}
	srv := httptest.NewServer(h.Mux())
	defer srv.Close()

	audio := []byte("fake audio data")
	resp, err := http.Post(srv.URL+"/process", "audio/mpeg", bytes.NewReader(audio))
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	if len(body) == 0 {
		t.Error("expected non-empty response body")
	}
}

func TestProcessHandler_NoBody(t *testing.T) {
	h := &Handler{Runner: &mockRunner{}}
	srv := httptest.NewServer(h.Mux())
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/process", "audio/mpeg", http.NoBody)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", resp.StatusCode)
	}
}

func TestProcessHandler_PipelineError(t *testing.T) {
	runner := &mockRunner{err: errors.New("pipeline failed")}

	h := &Handler{Runner: runner}
	srv := httptest.NewServer(h.Mux())
	defer srv.Close()

	audio := []byte("fake audio data")
	resp, err := http.Post(srv.URL+"/process", "audio/mpeg", bytes.NewReader(audio))
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", resp.StatusCode)
	}
}

func TestExtFromContentType(t *testing.T) {
	tests := []struct {
		contentType string
		want        string
	}{
		{"audio/wav", ".wav"},
		{"audio/x-wav", ".wav"},
		{"audio/ogg", ".ogg"},
		{"audio/flac", ".flac"},
		{"audio/mp4", ".m4a"},
		{"audio/m4a", ".m4a"},
		{"audio/webm", ".webm"},
		{"audio/mpeg", ".mp3"},
		{"", ".mp3"},
		{"application/octet-stream", ".mp3"},
	}

	for _, tt := range tests {
		t.Run(tt.contentType, func(t *testing.T) {
			got := extFromContentType(tt.contentType)
			if got != tt.want {
				t.Errorf("extFromContentType(%q) = %q, want %q", tt.contentType, got, tt.want)
			}
		})
	}
}

func TestProcessHandler_MethodNotAllowed(t *testing.T) {
	h := &Handler{Runner: &mockRunner{}}
	srv := httptest.NewServer(h.Mux())
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/process")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", resp.StatusCode)
	}
}
