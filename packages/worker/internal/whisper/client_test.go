package whisper

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestClient_Transcribe(t *testing.T) {
	// Mock OpenAI-compatible API server
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify request
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.URL.Path != "/v1/audio/transcriptions" {
			t.Errorf("expected /v1/audio/transcriptions, got %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Errorf("expected Authorization 'Bearer test-key', got %q", got)
		}

		// Verify multipart form
		err := r.ParseMultipartForm(32 << 20)
		if err != nil {
			t.Fatalf("parse multipart: %v", err)
		}
		if got := r.FormValue("model"); got != "whisper-1" {
			t.Errorf("expected model 'whisper-1', got %q", got)
		}
		if got := r.FormValue("response_format"); got != "verbose_json" {
			t.Errorf("expected response_format 'verbose_json', got %q", got)
		}
		if got := r.FormValue("language"); got != "ja" {
			t.Errorf("expected language 'ja', got %q", got)
		}

		file, _, err := r.FormFile("file")
		if err != nil {
			t.Fatalf("get form file: %v", err)
		}
		defer file.Close()
		content, _ := io.ReadAll(file)
		if string(content) != "fake audio data" {
			t.Errorf("unexpected file content: %q", string(content))
		}

		// Respond with verbose_json
		resp := verboseJSONResponse{
			Text: "hello world",
			Segments: []segmentResponse{
				{Text: "hello ", Start: 0.0, End: 1.5},
				{Text: "world", Start: 1.5, End: 3.0},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	// Create a temp audio file
	tmpDir := t.TempDir()
	audioFile := filepath.Join(tmpDir, "test.mp3")
	os.WriteFile(audioFile, []byte("fake audio data"), 0o644)

	client := &Client{
		BaseURL: srv.URL,
		APIKey:  "test-key",
		Model:   "whisper-1",
	}

	result, err := client.Transcribe(context.Background(), audioFile)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Text != "hello world" {
		t.Errorf("expected text 'hello world', got %q", result.Text)
	}
	if len(result.Segments) != 2 {
		t.Fatalf("expected 2 segments, got %d", len(result.Segments))
	}
	if result.Segments[0].Text != "hello " {
		t.Errorf("segment[0].Text = %q, want 'hello '", result.Segments[0].Text)
	}
	if result.Segments[1].StartSec != 1.5 {
		t.Errorf("segment[1].StartSec = %f, want 1.5", result.Segments[1].StartSec)
	}
}

func TestClient_Transcribe_APIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error": {"message": "internal error"}}`))
	}))
	defer srv.Close()

	tmpDir := t.TempDir()
	audioFile := filepath.Join(tmpDir, "test.mp3")
	os.WriteFile(audioFile, []byte("fake"), 0o644)

	client := &Client{BaseURL: srv.URL, APIKey: "key", Model: "whisper-1"}
	_, err := client.Transcribe(context.Background(), audioFile)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestClient_Transcribe_FileNotFound(t *testing.T) {
	client := &Client{BaseURL: "http://localhost", APIKey: "key", Model: "whisper-1"}
	_, err := client.Transcribe(context.Background(), "/nonexistent/file.mp3")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestClient_Transcribe_WorkersAI(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.URL.Path != "/run/@cf/openai/whisper-large-v3-turbo" {
			t.Errorf("expected /run/@cf/openai/whisper-large-v3-turbo, got %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Errorf("expected Authorization 'Bearer test-key', got %q", got)
		}
		if got := r.Header.Get("cf-aig-authorization"); got != "Bearer test-key" {
			t.Errorf("expected cf-aig-authorization 'Bearer test-key', got %q", got)
		}

		if ct := r.Header.Get("Content-Type"); ct != "audio/mpeg" {
			t.Errorf("expected Content-Type 'audio/mpeg', got %q", ct)
		}

		body, _ := io.ReadAll(r.Body)
		if string(body) != "fake audio data" {
			t.Errorf("unexpected body: %q", string(body))
		}

		resp := workersAIResponse{
			Success: true,
			Result: workersAIResult{
				Text: "hello world",
				Segments: []segmentResponse{
					{Text: "hello ", Start: 0.0, End: 1.5},
					{Text: "world", Start: 1.5, End: 3.0},
				},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	tmpDir := t.TempDir()
	audioFile := filepath.Join(tmpDir, "test.mp3")
	os.WriteFile(audioFile, []byte("fake audio data"), 0o644)

	client := &Client{
		BaseURL: srv.URL,
		APIKey:  "test-key",
		Model:   "@cf/openai/whisper-large-v3-turbo",
	}

	result, err := client.Transcribe(context.Background(), audioFile)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Text != "hello world" {
		t.Errorf("expected text 'hello world', got %q", result.Text)
	}
	if len(result.Segments) != 2 {
		t.Fatalf("expected 2 segments, got %d", len(result.Segments))
	}
}

func TestClient_Transcribe_WorkersAI_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := workersAIResponse{
			Success: false,
			Errors:  []workersAIError{{Code: 8001, Message: "Invalid input"}},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	tmpDir := t.TempDir()
	audioFile := filepath.Join(tmpDir, "test.mp3")
	os.WriteFile(audioFile, []byte("fake"), 0o644)

	client := &Client{BaseURL: srv.URL, APIKey: "key", Model: "@cf/openai/whisper-large-v3-turbo"}
	_, err := client.Transcribe(context.Background(), audioFile)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}
