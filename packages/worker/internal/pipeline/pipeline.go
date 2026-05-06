package pipeline

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/owk-owk130/koe/packages/worker/internal/splitter"
	"github.com/owk-owk130/koe/packages/worker/internal/storage"
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

// Pipeline orchestrates audio splitting and transcription. Topic analysis is
// owned by the Workers TS side now and is not part of this struct.
type Pipeline struct {
	Splitter    splitter.Splitter
	Transcriber whisper.Transcriber
	Storage     storage.Storage // nil for CLI mode (no persistence)
}

// Transcribe runs split + Whisper. The orchestrator persists the output to R2
// so the analyze phase can resume independently without re-charging Whisper.
func (p *Pipeline) Transcribe(ctx context.Context, audioPath string) (*TranscribeOutput, error) {
	splitStart := time.Now()
	chunks, err := p.Splitter.Split(ctx, audioPath)
	if err != nil {
		return nil, fmt.Errorf("split: %w", err)
	}
	defer func() {
		// Splitter creates one tmp dir per call (~60 chunk files at the new
		// 60s window). Without this the container leaks ~60 MB per request.
		if cleanupErr := p.Splitter.Cleanup(chunks); cleanupErr != nil {
			log.Printf("[pipeline] splitter cleanup failed: %v", cleanupErr)
		}
	}()
	log.Printf("[pipeline] split done chunks=%d elapsed=%s", len(chunks), time.Since(splitStart))

	var allSegments []whisper.Segment
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

	// allSegments を結合した text フィールドは API 側ではもう使わない
	// (analyze は Workers TS で segments から直接構築する) が、互換のため
	// 一応 fullText を保持しておく。
	fullText := buildFullText(chunkResults)

	return &TranscribeOutput{
		Transcript: whisper.Transcript{Text: fullText, Segments: allSegments},
		Chunks:     chunkResults,
	}, nil
}

func buildFullText(chunks []ChunkResult) string {
	total := 0
	for _, c := range chunks {
		total += len(c.Text) + 1
	}
	if total == 0 {
		return ""
	}
	out := make([]byte, 0, total)
	for _, c := range chunks {
		out = append(out, c.Text...)
		out = append(out, '\n')
	}
	return string(out)
}
