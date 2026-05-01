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
	"github.com/owk-owk130/koe/packages/worker/internal/whisper"
)

// Runner abstracts the two pipeline phases for testability.
// /transcribe → Transcribe (split + whisper)
// /analyze    → Analyze (gemini, given pre-computed segments)
type Runner interface {
	Transcribe(ctx context.Context, audioPath string) (*pipeline.TranscribeOutput, error)
	Analyze(ctx context.Context, segments []whisper.Segment) (*pipeline.AnalyzeOutput, error)
}

// Handler holds HTTP handler dependencies.
type Handler struct {
	Runner Runner
}

// Mux returns an http.Handler with all routes registered.
func (h *Handler) Mux() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", h.handleHealth)

	mux.HandleFunc("POST /transcribe", h.handleTranscribe)
	mux.HandleFunc("/transcribe", h.handleMethodNotAllowed)

	mux.HandleFunc("POST /analyze", h.handleAnalyze)
	mux.HandleFunc("/analyze", h.handleMethodNotAllowed)

	return mux
}

func (h *Handler) handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"ok"}`))
}

func (h *Handler) handleTranscribe(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	log.Printf("[transcribe] start content-type=%q", r.Header.Get("Content-Type"))

	tmpDir, err := os.MkdirTemp("", "koe-transcribe-*")
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
	log.Printf("[transcribe] audio saved bytes=%d elapsed=%s path=%s", n, time.Since(start), audioPath)

	out, err := h.Runner.Transcribe(r.Context(), audioPath)
	if err != nil {
		log.Printf("[transcribe] failed after %s: %v", time.Since(start), err)
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("transcribe failed: %v", err))
		return
	}
	log.Printf(
		"[transcribe] ok chunks=%d elapsed=%s",
		len(out.Chunks),
		time.Since(start),
	)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

type analyzeRequest struct {
	Segments []whisper.Segment `json:"segments"`
}

func (h *Handler) handleAnalyze(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

	var req analyzeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return
	}
	log.Printf("[analyze] start segments=%d", len(req.Segments))

	out, err := h.Runner.Analyze(r.Context(), req.Segments)
	if err != nil {
		log.Printf("[analyze] failed after %s: %v", time.Since(start), err)
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("analyze failed: %v", err))
		return
	}
	log.Printf(
		"[analyze] ok topics=%d elapsed=%s",
		len(out.Topics),
		time.Since(start),
	)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
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
