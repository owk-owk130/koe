package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

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
	start := time.Now()
	log.Printf("[process] start content-type=%q", r.Header.Get("Content-Type"))

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
	log.Printf("[process] audio saved bytes=%d elapsed=%s path=%s", n, time.Since(start), audioPath)

	result, err := h.Runner.Run(r.Context(), pipeline.Input{AudioPath: audioPath})
	if err != nil {
		log.Printf("[process] pipeline failed after %s: %v", time.Since(start), err)
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("pipeline failed: %v", err))
		return
	}
	log.Printf(
		"[process] pipeline ok chunks=%d topics=%d elapsed=%s",
		len(result.Chunks),
		len(result.Topics),
		time.Since(start),
	)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
	log.Printf("[process] done elapsed=%s", time.Since(start))
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
	case "audio/webm":
		return ".webm"
	default:
		return ".mp3"
	}
}
