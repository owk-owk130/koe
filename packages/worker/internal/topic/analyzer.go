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
	Detail     string  `json:"detail"`
	StartSec   float64 `json:"start_sec"`
	EndSec     float64 `json:"end_sec"`
	Transcript string  `json:"transcript"`
}

// AnalysisResult holds the overall summary and per-topic analysis.
type AnalysisResult struct {
	Summary string  `json:"summary"`
	Topics  []Topic `json:"topics"`
}

// Analyzer splits a transcript into topics using an LLM.
type Analyzer interface {
	Analyze(ctx context.Context, transcript string, segments []whisper.Segment) (*AnalysisResult, error)
}
