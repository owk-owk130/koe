package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/owk-owk130/koe/packages/worker/internal/pipeline"
	"github.com/owk-owk130/koe/packages/worker/internal/server"
	"github.com/owk-owk130/koe/packages/worker/internal/splitter"
	"github.com/owk-owk130/koe/packages/worker/internal/topic"
	"github.com/owk-owk130/koe/packages/worker/internal/whisper"
)

func main() {
	whisperURL := os.Getenv("WHISPER_BASE_URL")
	whisperKey := os.Getenv("WHISPER_API_KEY")
	whisperModel := os.Getenv("WHISPER_MODEL")
	geminiKey := os.Getenv("GEMINI_API_KEY")
	geminiModel := envOrDefault("GEMINI_MODEL", "gemini-2.0-flash-lite")
	port := envOrDefault("PORT", "8080")

	if whisperURL == "" {
		log.Fatal("WHISPER_BASE_URL is required")
	}
	if whisperKey == "" {
		log.Fatal("WHISPER_API_KEY is required")
	}
	if whisperModel == "" {
		log.Fatal("WHISPER_MODEL is required")
	}
	if geminiKey == "" {
		log.Fatal("GEMINI_API_KEY is required")
	}

	p := &pipeline.Pipeline{
		Splitter: &splitter.FFmpegSplitter{
			// Cap each chunk well under Cloudflare Workers AI Whisper's effective
			// request limit. The endpoint is documented as preferring ~1MB
			// requests, with reports of 2MB+ payloads being rejected. 60s of
			// mp3 is typically 0.7-1.0MB at 96-128 kbps, which keeps every
			// chunk inside the safe band.
			MaxChunkDuration: 60,
		},
		Transcriber: &whisper.Client{
			BaseURL: whisperURL,
			APIKey:  whisperKey,
			Model:   whisperModel,
		},
		Analyzer: &topic.GeminiAnalyzer{
			APIKey: geminiKey,
			Model:  geminiModel,
		},
	}

	h := &server.Handler{Runner: p}

	srv := &http.Server{
		Addr:    ":" + port,
		Handler: h.Mux(),
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	go func() {
		<-ctx.Done()
		log.Println("Shutting down...")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx)
	}()

	fmt.Fprintf(os.Stderr, "koe server listening on :%s\n", port)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
