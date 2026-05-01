package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/owk-owk130/koe/packages/worker/internal/pipeline"
	"github.com/owk-owk130/koe/packages/worker/internal/whisper"
)

type mockRunner struct {
	transcribeOut *pipeline.TranscribeOutput
	transcribeErr error
}

func (m *mockRunner) Transcribe(
	_ context.Context,
	_ string,
) (*pipeline.TranscribeOutput, error) {
	return m.transcribeOut, m.transcribeErr
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

// /transcribe receives raw audio and returns the Whisper artifact.
func TestTranscribeHandler_Success(t *testing.T) {
	runner := &mockRunner{
		transcribeOut: &pipeline.TranscribeOutput{
			Transcript: whisper.Transcript{
				Text: "hello world",
				Segments: []whisper.Segment{
					{Text: "hello world", StartSec: 0, EndSec: 10},
				},
			},
			Chunks: []pipeline.ChunkResult{
				{Index: 0, StartSec: 0, EndSec: 10, Text: "hello world"},
			},
		},
	}
	h := &Handler{Runner: runner}
	srv := httptest.NewServer(h.Mux())
	defer srv.Close()

	resp, err := http.Post(
		srv.URL+"/transcribe",
		"audio/mpeg",
		bytes.NewReader([]byte("fake audio data")),
	)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	var got pipeline.TranscribeOutput
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Transcript.Text != "hello world" {
		t.Errorf("Transcript.Text = %q", got.Transcript.Text)
	}
	if len(got.Chunks) != 1 {
		t.Errorf("expected 1 chunk, got %d", len(got.Chunks))
	}
}

func TestTranscribeHandler_NoBody(t *testing.T) {
	h := &Handler{Runner: &mockRunner{}}
	srv := httptest.NewServer(h.Mux())
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/transcribe", "audio/mpeg", http.NoBody)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", resp.StatusCode)
	}
}

func TestTranscribeHandler_PipelineError(t *testing.T) {
	runner := &mockRunner{transcribeErr: errors.New("transcribe failed")}
	h := &Handler{Runner: runner}
	srv := httptest.NewServer(h.Mux())
	defer srv.Close()

	resp, err := http.Post(
		srv.URL+"/transcribe",
		"audio/mpeg",
		bytes.NewReader([]byte("fake")),
	)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", resp.StatusCode)
	}
}

func TestTranscribeHandler_MethodNotAllowed(t *testing.T) {
	h := &Handler{Runner: &mockRunner{}}
	srv := httptest.NewServer(h.Mux())
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/transcribe")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", resp.StatusCode)
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
