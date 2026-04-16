package topic

import (
	"context"

	"github.com/owk-owk130/koe/packages/worker/internal/whisper"
)

// NoopAnalyzer is an Analyzer that returns no topics (for transcribe-only mode).
type NoopAnalyzer struct{}

func (NoopAnalyzer) Analyze(_ context.Context, _ string, _ []whisper.Segment) (*AnalysisResult, error) {
	return &AnalysisResult{}, nil
}
