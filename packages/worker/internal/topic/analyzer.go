package topic

import (
	"context"

	"github.com/owk-owk130/koe/packages/worker/internal/whisper"
)

// Topic represents a detected topic segment.
type Topic struct {
	Index      int
	Title      string
	Summary    string
	StartSec   float64
	EndSec     float64
	Transcript string
}

// Analyzer splits a transcript into topics using an LLM.
type Analyzer interface {
	Analyze(ctx context.Context, transcript string, segments []whisper.Segment) ([]Topic, error)
}
