package pipeline

import (
	"context"

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

// Result represents the output of a pipeline run.
type Result struct {
	Transcript whisper.Transcript
	Topics     []topic.Topic
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
	chunks, err := p.Splitter.Split(ctx, in.AudioPath)
	if err != nil {
		return nil, err
	}

	// 2. Transcribe each chunk
	var allSegments []whisper.Segment
	var fullText string

	for _, chunk := range chunks {
		t, err := p.Transcriber.Transcribe(ctx, chunk.Path)
		if err != nil {
			return nil, err
		}
		fullText += t.Text + "\n"
		allSegments = append(allSegments, t.Segments...)
	}

	transcript := whisper.Transcript{
		Text:     fullText,
		Segments: allSegments,
	}

	// 3. Analyze topics
	topics, err := p.Analyzer.Analyze(ctx, fullText, allSegments)
	if err != nil {
		return nil, err
	}

	return &Result{
		Transcript: transcript,
		Topics:     topics,
	}, nil
}
