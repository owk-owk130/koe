package pipeline

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/owk-owk130/koe/packages/worker/internal/splitter"
	"github.com/owk-owk130/koe/packages/worker/internal/storage"
	"github.com/owk-owk130/koe/packages/worker/internal/topic"
	"github.com/owk-owk130/koe/packages/worker/internal/whisper"
)

// Input represents the input for a pipeline run.
type Input struct {
	AudioPath string
	JobID     string
	UserID    string
}

// ChunkResult represents a processed audio chunk with its transcript.
type ChunkResult struct {
	Index    int     `json:"index"`
	StartSec float64 `json:"start_sec"`
	EndSec   float64 `json:"end_sec"`
	Text     string  `json:"text"`
}

// Result represents the output of a pipeline run.
type Result struct {
	Transcript whisper.Transcript `json:"transcript"`
	Summary    string             `json:"summary"`
	Topics     []topic.Topic      `json:"topics"`
	Chunks     []ChunkResult      `json:"chunks"`
}

// Pipeline orchestrates audio splitting, transcription, and topic analysis.
type Pipeline struct {
	Splitter    splitter.Splitter
	Transcriber whisper.Transcriber
	Analyzer    topic.Analyzer
	Storage     storage.Storage // nil for CLI mode (no persistence)
}

// Run executes the full pipeline: split → transcribe → analyze.
func (p *Pipeline) Run(ctx context.Context, in Input) (*Result, error) {
	// 1. Split audio into chunks
	splitStart := time.Now()
	chunks, err := p.Splitter.Split(ctx, in.AudioPath)
	if err != nil {
		return nil, fmt.Errorf("split: %w", err)
	}
	log.Printf("[pipeline] split done chunks=%d elapsed=%s", len(chunks), time.Since(splitStart))

	// 2. Transcribe each chunk
	var allSegments []whisper.Segment
	var fullText string
	chunkResults := make([]ChunkResult, 0, len(chunks))

	for _, chunk := range chunks {
		chunkStart := time.Now()
		t, err := p.Transcriber.Transcribe(ctx, chunk.Path)
		if err != nil {
			return nil, fmt.Errorf("transcribe chunk %d: %w", chunk.Index, err)
		}
		log.Printf(
			"[pipeline] transcribe chunk=%d/%d start=%.1f end=%.1f elapsed=%s",
			chunk.Index+1,
			len(chunks),
			chunk.StartSec,
			chunk.EndSec,
			time.Since(chunkStart),
		)
		fullText += t.Text + "\n"
		allSegments = append(allSegments, t.Segments...)
		chunkResults = append(chunkResults, ChunkResult{
			Index:    chunk.Index,
			StartSec: chunk.StartSec,
			EndSec:   chunk.EndSec,
			Text:     t.Text,
		})
	}

	transcript := whisper.Transcript{
		Text:     fullText,
		Segments: allSegments,
	}

	// 3. Analyze topics
	analyzeStart := time.Now()
	analysis, err := p.Analyzer.Analyze(ctx, fullText, allSegments)
	if err != nil {
		return nil, fmt.Errorf("analyze: %w", err)
	}
	log.Printf(
		"[pipeline] analyze done topics=%d elapsed=%s",
		len(analysis.Topics),
		time.Since(analyzeStart),
	)

	return &Result{
		Transcript: transcript,
		Summary:    analysis.Summary,
		Topics:     analysis.Topics,
		Chunks:     chunkResults,
	}, nil
}
