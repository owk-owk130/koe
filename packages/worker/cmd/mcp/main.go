package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	mcphandler "github.com/owk-owk130/koe/packages/worker/internal/mcp"
	"github.com/owk-owk130/koe/packages/worker/internal/pipeline"
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

	if whisperKey == "" {
		fmt.Fprintln(os.Stderr, "error: WHISPER_API_KEY is required")
		os.Exit(1)
	}

	transcriber := &whisper.Client{
		BaseURL: whisperURL,
		APIKey:  whisperKey,
		Model:   whisperModel,
	}

	transcribePipeline := &pipeline.Pipeline{
		Splitter:    &splitter.FFmpegSplitter{},
		Transcriber: transcriber,
		Analyzer:    mcphandler.NoopAnalyzer{},
	}

	h := &mcphandler.Handler{
		TranscribePipeline: transcribePipeline,
	}

	// GEMINI_API_KEY がある場合のみ transcribe_split パイプラインを構築
	if geminiKey != "" {
		h.FullPipeline = &pipeline.Pipeline{
			Splitter:    &splitter.FFmpegSplitter{},
			Transcriber: transcriber,
			Analyzer: &topic.GeminiAnalyzer{
				APIKey: geminiKey,
				Model:  geminiModel,
			},
		}
	}

	srv := server.NewMCPServer(
		"koe",
		"0.1.0",
		server.WithToolCapabilities(false),
	)

	srv.AddTool(
		mcp.NewTool("transcribe",
			mcp.WithDescription("音声ファイルを文字起こしする。テキストとタイムスタンプ付きセグメントをJSON形式で返す。"),
			mcp.WithString("audio_path",
				mcp.Required(),
				mcp.Description("音声ファイルの絶対パス"),
			),
		),
		h.HandleTranscribe,
	)

	if h.FullPipeline != nil {
		srv.AddTool(
			mcp.NewTool("transcribe_split",
				mcp.WithDescription("音声ファイルを文字起こしし、トピックごとに分割する。文字起こし結果とトピック一覧をJSON形式で返す。"),
				mcp.WithString("audio_path",
					mcp.Required(),
					mcp.Description("音声ファイルの絶対パス"),
				),
			),
			h.HandleTranscribeSplit,
		)
	} else {
		fmt.Fprintln(os.Stderr, "warning: GEMINI_API_KEY is not set, transcribe_split tool is disabled")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	if err := server.ServeStdio(srv, server.WithStdioContextFunc(func(_ context.Context) context.Context {
		return ctx
	})); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
