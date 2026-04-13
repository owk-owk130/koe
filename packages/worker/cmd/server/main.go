package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"

	"github.com/owk-owk130/koe/packages/worker/internal/pipeline"
	"github.com/owk-owk130/koe/packages/worker/internal/server"
	"github.com/owk-owk130/koe/packages/worker/internal/splitter"
	"github.com/owk-owk130/koe/packages/worker/internal/topic"
	"github.com/owk-owk130/koe/packages/worker/internal/whisper"
)

func main() {
	whisperURL := envOrDefault("WHISPER_BASE_URL", "https://api.openai.com")
	whisperKey := os.Getenv("WHISPER_API_KEY")
	whisperModel := envOrDefault("WHISPER_MODEL", "whisper-1")
	geminiKey := os.Getenv("GEMINI_API_KEY")
	geminiModel := envOrDefault("GEMINI_MODEL", "gemini-2.0-flash-lite")
	port := envOrDefault("PORT", "8080")

	if whisperKey == "" {
		log.Fatal("WHISPER_API_KEY is required")
	}
	if geminiKey == "" {
		log.Fatal("GEMINI_API_KEY is required")
	}

	p := &pipeline.Pipeline{
		Splitter: &splitter.FFmpegSplitter{},
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
		srv.Close()
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
