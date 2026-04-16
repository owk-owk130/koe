package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"

	"github.com/owk-owk130/koe/packages/worker/internal/pipeline"
	"github.com/owk-owk130/koe/packages/worker/internal/splitter"
	"github.com/owk-owk130/koe/packages/worker/internal/topic"
	"github.com/owk-owk130/koe/packages/worker/internal/whisper"
)

func main() {
	var (
		output      string
		whisperURL  string
		whisperKey  string
		model       string
		geminiKey   string
		geminiModel string
	)

	flag.StringVar(&output, "o", "", "output file path (default: stdout)")
	flag.StringVar(&whisperURL, "whisper-url", os.Getenv("WHISPER_BASE_URL"), "Whisper API base URL")
	flag.StringVar(&whisperKey, "whisper-key", os.Getenv("WHISPER_API_KEY"), "Whisper API key")
	flag.StringVar(&model, "model", os.Getenv("WHISPER_MODEL"), "Whisper model name")
	flag.StringVar(&geminiKey, "gemini-key", os.Getenv("GEMINI_API_KEY"), "Gemini API key")
	flag.StringVar(&geminiModel, "gemini-model", envOrDefault("GEMINI_MODEL", "gemini-2.0-flash-lite"), "Gemini model name")

	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage: koe [options] <audio-file>\n\nOptions:\n")
		flag.PrintDefaults()
	}
	flag.Parse()

	if flag.NArg() < 1 {
		flag.Usage()
		os.Exit(1)
	}
	audioPath := flag.Arg(0)

	if whisperURL == "" {
		fmt.Fprintln(os.Stderr, "error: WHISPER_BASE_URL is required (--whisper-url or WHISPER_BASE_URL)")
		os.Exit(1)
	}
	if whisperKey == "" {
		fmt.Fprintln(os.Stderr, "error: WHISPER_API_KEY is required (--whisper-key or WHISPER_API_KEY)")
		os.Exit(1)
	}
	if model == "" {
		fmt.Fprintln(os.Stderr, "error: WHISPER_MODEL is required (--model or WHISPER_MODEL)")
		os.Exit(1)
	}
	if geminiKey == "" {
		fmt.Fprintln(os.Stderr, "error: GEMINI_API_KEY is required (--gemini-key or GEMINI_API_KEY)")
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	p := &pipeline.Pipeline{
		Splitter: &splitter.FFmpegSplitter{},
		Transcriber: &whisper.Client{
			BaseURL: whisperURL,
			APIKey:  whisperKey,
			Model:   model,
		},
		Analyzer: &topic.GeminiAnalyzer{
			APIKey: geminiKey,
			Model:  geminiModel,
		},
	}

	fmt.Fprintf(os.Stderr, "Processing: %s\n", audioPath)

	result, err := p.Run(ctx, pipeline.Input{AudioPath: audioPath})
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}

	jsonBytes, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: marshal result: %v\n", err)
		os.Exit(1)
	}

	if output != "" {
		if err := os.WriteFile(output, jsonBytes, 0o644); err != nil {
			fmt.Fprintf(os.Stderr, "error: write output: %v\n", err)
			os.Exit(1)
		}
		fmt.Fprintf(os.Stderr, "Result written to %s\n", output)
	} else {
		fmt.Println(string(jsonBytes))
	}
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
