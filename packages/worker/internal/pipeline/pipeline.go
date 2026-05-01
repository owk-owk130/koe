package pipeline

import (
	"context"
	"fmt"
	"log"
	"strings"
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

// TranscribeOutput is the persisted artifact of the Whisper-only phase.
// The orchestrator uploads this to R2 between phases so analyze can resume
// without redoing transcription on Gemini failures.
type TranscribeOutput struct {
	Transcript whisper.Transcript `json:"transcript"`
	Chunks     []ChunkResult      `json:"chunks"`
}

// AnalyzeOutput is the result of running Gemini on pre-computed segments.
type AnalyzeOutput struct {
	Summary string        `json:"summary"`
	Topics  []topic.Topic `json:"topics"`
}

// Result represents the output of a full pipeline run (CLI / sidecar / mcp).
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

// Transcribe runs split + Whisper. Kept separate so the server can persist its
// output and let analyze resume without re-charging Whisper on Gemini failures.
func (p *Pipeline) Transcribe(ctx context.Context, audioPath string) (*TranscribeOutput, error) {
	splitStart := time.Now()
	chunks, err := p.Splitter.Split(ctx, audioPath)
	if err != nil {
		return nil, fmt.Errorf("split: %w", err)
	}
	log.Printf("[pipeline] split done chunks=%d elapsed=%s", len(chunks), time.Since(splitStart))

	var allSegments []whisper.Segment
	var fullText strings.Builder
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
		fullText.WriteString(t.Text)
		fullText.WriteByte('\n')
		// Whisper returns chunk-local timestamps; shift onto the global timeline.
		for _, seg := range t.Segments {
			seg.StartSec += chunk.StartSec
			seg.EndSec += chunk.StartSec
			allSegments = append(allSegments, seg)
		}
		chunkResults = append(chunkResults, ChunkResult{
			Index:    chunk.Index,
			StartSec: chunk.StartSec,
			EndSec:   chunk.EndSec,
			Text:     t.Text,
		})
	}

	return &TranscribeOutput{
		Transcript: whisper.Transcript{Text: fullText.String(), Segments: allSegments},
		Chunks:     chunkResults,
	}, nil
}

// Analyze runs the topic analyzer on pre-computed segments. The transcript
// argument expected by the Analyzer interface is rebuilt from segments so the
// caller doesn't need to pass it twice.
func (p *Pipeline) Analyze(
	ctx context.Context,
	segments []whisper.Segment,
) (*AnalyzeOutput, error) {
	analyzeStart := time.Now()
	var fullText strings.Builder
	for _, s := range segments {
		fullText.WriteString(s.Text)
		fullText.WriteByte('\n')
	}
	analysis, err := p.Analyzer.Analyze(ctx, fullText.String(), segments)
	if err != nil {
		return nil, fmt.Errorf("analyze: %w", err)
	}
	log.Printf(
		"[pipeline] analyze done topics=%d elapsed=%s",
		len(analysis.Topics),
		time.Since(analyzeStart),
	)
	return &AnalyzeOutput{Summary: analysis.Summary, Topics: analysis.Topics}, nil
}

// Run executes the full pipeline (transcribe + analyze) for CLI/sidecar/mcp use.
func (p *Pipeline) Run(ctx context.Context, in Input) (*Result, error) {
	t, err := p.Transcribe(ctx, in.AudioPath)
	if err != nil {
		return nil, err
	}
	a, err := p.Analyze(ctx, t.Transcript.Segments)
	if err != nil {
		return nil, err
	}
	return &Result{
		Transcript: t.Transcript,
		Summary:    a.Summary,
		Topics:     a.Topics,
		Chunks:     t.Chunks,
	}, nil
}
