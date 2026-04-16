package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/owk-owk130/koe/packages/worker/internal/pipeline"
	"github.com/owk-owk130/koe/packages/worker/internal/server"
	"github.com/owk-owk130/koe/packages/worker/internal/splitter"
	"github.com/owk-owk130/koe/packages/worker/internal/topic"
	"github.com/owk-owk130/koe/packages/worker/internal/whisper"
)

type config struct {
	WhisperBaseURL string `json:"whisper_base_url"`
	WhisperAPIKey  string `json:"whisper_api_key"`
	WhisperModel   string `json:"whisper_model"`
	GeminiAPIKey   string `json:"gemini_api_key"`
	GeminiModel    string `json:"gemini_model"`
	FFmpegPath     string `json:"ffmpeg_path"`
	FFprobePath    string `json:"ffprobe_path"`
}

func main() {
	// 1. Read config from stdin
	cfg, err := readConfig(os.Stdin)
	if err != nil {
		log.Fatalf("read config: %v", err)
	}

	if cfg.WhisperBaseURL == "" || cfg.WhisperAPIKey == "" || cfg.WhisperModel == "" {
		log.Fatal("whisper_base_url, whisper_api_key, and whisper_model are required")
	}

	// 2. Build pipeline
	var analyzer topic.Analyzer
	if cfg.GeminiAPIKey != "" {
		model := cfg.GeminiModel
		if model == "" {
			model = "gemini-2.0-flash-lite"
		}
		analyzer = &topic.GeminiAnalyzer{
			APIKey: cfg.GeminiAPIKey,
			Model:  model,
		}
	} else {
		analyzer = topic.NoopAnalyzer{}
		fmt.Fprintln(os.Stderr, "warning: gemini_api_key not set, topic analysis disabled")
	}

	p := &pipeline.Pipeline{
		Splitter: &splitter.FFmpegSplitter{
			FFmpegPath:  cfg.FFmpegPath,
			FFprobePath: cfg.FFprobePath,
		},
		Transcriber: &whisper.Client{
			BaseURL: cfg.WhisperBaseURL,
			APIKey:  cfg.WhisperAPIKey,
			Model:   cfg.WhisperModel,
		},
		Analyzer: analyzer,
	}

	h := &server.Handler{Runner: p}

	// 3. Listen on random port
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatalf("listen: %v", err)
	}

	port := ln.Addr().(*net.TCPAddr).Port

	srv := &http.Server{
		Handler: h.Mux(),
	}

	// 4. Write port to stdout for Electron to read
	json.NewEncoder(os.Stdout).Encode(map[string]int{"port": port})

	// 5. Setup shutdown: SIGINT, SIGTERM, or stdin EOF
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Monitor stdin EOF (parent process death).
	// Note: Electron must keep stdin open after writing config JSON.
	// Closing stdin signals the sidecar to shut down.
	go func() {
		io.Copy(io.Discard, os.Stdin)
		stop()
	}()

	go func() {
		<-ctx.Done()
		fmt.Fprintln(os.Stderr, "shutting down...")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx)
	}()

	fmt.Fprintf(os.Stderr, "koe sidecar listening on 127.0.0.1:%d\n", port)
	if err := srv.Serve(ln); err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
}

func readConfig(r io.Reader) (*config, error) {
	var cfg config
	if err := json.NewDecoder(r).Decode(&cfg); err != nil {
		return nil, fmt.Errorf("decode JSON: %w", err)
	}
	return &cfg, nil
}
