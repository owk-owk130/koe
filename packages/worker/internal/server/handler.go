package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"github.com/owk-owk130/koe/packages/worker/internal/pipeline"
)

// Runner abstracts pipeline execution for testability.
type Runner interface {
	Run(ctx context.Context, in pipeline.Input) (*pipeline.Result, error)
}

// Handler holds HTTP handler dependencies.
type Handler struct {
	Runner Runner
}

// Mux returns an http.Handler with all routes registered.
func (h *Handler) Mux() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", h.handleHealth)
	mux.HandleFunc("POST /process", h.handleProcess)
	mux.HandleFunc("/process", h.handleMethodNotAllowed)
	return mux
}

func (h *Handler) handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"ok"}`))
}

func (h *Handler) handleProcess(w http.ResponseWriter, r *http.Request) {
	// Save request body to a temp file (streaming, no full buffering)
	tmpDir, err := os.MkdirTemp("", "koe-process-*")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "create temp dir: "+err.Error())
		return
	}
	defer os.RemoveAll(tmpDir)

	ext := extFromContentType(r.Header.Get("Content-Type"))
	audioPath := filepath.Join(tmpDir, "input"+ext)

	f, err := os.Create(audioPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "create temp file: "+err.Error())
		return
	}

	n, err := io.Copy(f, r.Body)
	f.Close()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "read audio: "+err.Error())
		return
	}
	if n == 0 {
		writeError(w, http.StatusBadRequest, "empty audio body")
		return
	}

	result, err := h.Runner.Run(r.Context(), pipeline.Input{AudioPath: audioPath})
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("pipeline failed: %v", err))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (h *Handler) handleMethodNotAllowed(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusMethodNotAllowed, "method not allowed")
}

func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

func extFromContentType(ct string) string {
	switch ct {
	case "audio/wav", "audio/x-wav":
		return ".wav"
	case "audio/ogg":
		return ".ogg"
	case "audio/flac":
		return ".flac"
	case "audio/mp4", "audio/m4a":
		return ".m4a"
	default:
		return ".mp3"
	}
}
