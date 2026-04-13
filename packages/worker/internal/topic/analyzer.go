package topic

import (
	"context"

	"github.com/owk-owk130/koe/packages/worker/internal/whisper"
)

// Topic represents a detected topic segment.
type Topic struct {
	Index      int     `json:"index"`
	Title      string  `json:"title"`
	Summary    string  `json:"summary"`
	StartSec   float64 `json:"start_sec"`
	EndSec     float64 `json:"end_sec"`
	Transcript string  `json:"transcript"`
}

// Analyzer splits a transcript into topics using an LLM.
type Analyzer interface {
	Analyze(ctx context.Context, transcript string, segments []whisper.Segment) ([]Topic, error)
}
