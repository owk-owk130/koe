package pipeline

import (
	"context"
	"errors"
	"testing"

	"github.com/owk-owk130/koe/packages/worker/internal/splitter"
	"github.com/owk-owk130/koe/packages/worker/internal/topic"
	"github.com/owk-owk130/koe/packages/worker/internal/whisper"
)

// --- mocks ---

type mockSplitter struct {
	chunks []splitter.Chunk
	err    error
}

func (m *mockSplitter) Split(_ context.Context, _ string) ([]splitter.Chunk, error) {
	return m.chunks, m.err
}

type mockTranscriber struct {
	results map[string]*whisper.Transcript
	err     error
}

func (m *mockTranscriber) Transcribe(_ context.Context, audioPath string) (*whisper.Transcript, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.results[audioPath], nil
}

type mockAnalyzer struct {
	result *topic.AnalysisResult
	err    error
}

func (m *mockAnalyzer) Analyze(_ context.Context, _ string, _ []whisper.Segment) (*topic.AnalysisResult, error) {
	return m.result, m.err
}

// --- tests ---

func TestPipeline_Run(t *testing.T) {
	chunks := []splitter.Chunk{
		{Index: 0, Path: "chunk0.mp3", StartSec: 0, EndSec: 30},
		{Index: 1, Path: "chunk1.mp3", StartSec: 30, EndSec: 60},
	}

	// Whisper returns chunk-local timestamps (each chunk's first segment starts
	// at 0). The pipeline must shift them onto the global timeline.
	transcripts := map[string]*whisper.Transcript{
		"chunk0.mp3": {
			Text: "hello world",
			Segments: []whisper.Segment{
				{Text: "hello", StartSec: 0, EndSec: 5},
				{Text: "world", StartSec: 25, EndSec: 30},
			},
		},
		"chunk1.mp3": {
			Text: "goodbye world",
			Segments: []whisper.Segment{
				{Text: "goodbye", StartSec: 0, EndSec: 5},
				{Text: "world", StartSec: 25, EndSec: 30},
			},
		},
	}

	analysisResult := &topic.AnalysisResult{
		Summary: "A conversation with greeting and farewell.",
		Topics: []topic.Topic{
			{Index: 0, Title: "Greeting", Summary: "A greeting", StartSec: 0, EndSec: 30},
			{Index: 1, Title: "Farewell", Summary: "A farewell", StartSec: 30, EndSec: 60},
		},
	}

	p := &Pipeline{
		Splitter:    &mockSplitter{chunks: chunks},
		Transcriber: &mockTranscriber{results: transcripts},
		Analyzer:    &mockAnalyzer{result: analysisResult},
	}

	result, err := p.Run(context.Background(), Input{
		AudioPath: "test.mp3",
		JobID:     "job-1",
		UserID:    "user-1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(result.Transcript.Segments) != 4 {
		t.Errorf("expected 4 segments, got %d", len(result.Transcript.Segments))
	}

	// chunk0 segments stay at chunk-local times because chunk.StartSec=0.
	// chunk1 segments must be shifted by +30s onto the global timeline.
	wantSegmentTimes := []struct{ start, end float64 }{
		{0, 5}, {25, 30}, {30, 35}, {55, 60},
	}
	for i, want := range wantSegmentTimes {
		got := result.Transcript.Segments[i]
		if got.StartSec != want.start || got.EndSec != want.end {
			t.Errorf("segment[%d] times = (%v,%v), want (%v,%v)",
				i, got.StartSec, got.EndSec, want.start, want.end)
		}
	}

	if result.Summary != "A conversation with greeting and farewell." {
		t.Errorf("expected summary, got %q", result.Summary)
	}

	if len(result.Topics) != 2 {
		t.Errorf("expected 2 topics, got %d", len(result.Topics))
	}

	wantText := "hello world\ngoodbye world\n"
	if result.Transcript.Text != wantText {
		t.Errorf("expected text %q, got %q", wantText, result.Transcript.Text)
	}

	if len(result.Chunks) != 2 {
		t.Fatalf("expected 2 chunks, got %d", len(result.Chunks))
	}

	if result.Chunks[0].Index != 0 || result.Chunks[0].StartSec != 0 || result.Chunks[0].EndSec != 30 {
		t.Errorf("unexpected chunk[0]: %+v", result.Chunks[0])
	}
	if result.Chunks[0].Text != "hello world" {
		t.Errorf("expected chunk[0] text %q, got %q", "hello world", result.Chunks[0].Text)
	}
	if result.Chunks[1].Index != 1 || result.Chunks[1].StartSec != 30 || result.Chunks[1].EndSec != 60 {
		t.Errorf("unexpected chunk[1]: %+v", result.Chunks[1])
	}
	if result.Chunks[1].Text != "goodbye world" {
		t.Errorf("expected chunk[1] text %q, got %q", "goodbye world", result.Chunks[1].Text)
	}
}

func TestPipeline_Run_SplitterError(t *testing.T) {
	p := &Pipeline{
		Splitter:    &mockSplitter{err: errors.New("split failed")},
		Transcriber: &mockTranscriber{},
		Analyzer:    &mockAnalyzer{},
	}

	_, err := p.Run(context.Background(), Input{AudioPath: "test.mp3"})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestPipeline_Run_TranscriberError(t *testing.T) {
	p := &Pipeline{
		Splitter: &mockSplitter{chunks: []splitter.Chunk{
			{Index: 0, Path: "chunk0.mp3"},
		}},
		Transcriber: &mockTranscriber{err: errors.New("transcribe failed")},
		Analyzer:    &mockAnalyzer{},
	}

	_, err := p.Run(context.Background(), Input{AudioPath: "test.mp3"})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestPipeline_Run_AnalyzerError(t *testing.T) {
	p := &Pipeline{
		Splitter: &mockSplitter{chunks: []splitter.Chunk{
			{Index: 0, Path: "chunk0.mp3"},
		}},
		Transcriber: &mockTranscriber{results: map[string]*whisper.Transcript{
			"chunk0.mp3": {Text: "hello", Segments: []whisper.Segment{{Text: "hello"}}},
		}},
		Analyzer: &mockAnalyzer{err: errors.New("analyze failed")},
	}

	_, err := p.Run(context.Background(), Input{AudioPath: "test.mp3"})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

// Transcribe is the standalone Whisper-only step used by the orchestrator to
// persist intermediate output before invoking Gemini.
func TestPipeline_Transcribe(t *testing.T) {
	chunks := []splitter.Chunk{
		{Index: 0, Path: "chunk0.mp3", StartSec: 0, EndSec: 30},
		{Index: 1, Path: "chunk1.mp3", StartSec: 30, EndSec: 60},
	}
	transcripts := map[string]*whisper.Transcript{
		"chunk0.mp3": {
			Text:     "hello",
			Segments: []whisper.Segment{{Text: "hello", StartSec: 0, EndSec: 5}},
		},
		"chunk1.mp3": {
			Text:     "world",
			Segments: []whisper.Segment{{Text: "world", StartSec: 30, EndSec: 35}},
		},
	}

	p := &Pipeline{
		Splitter:    &mockSplitter{chunks: chunks},
		Transcriber: &mockTranscriber{results: transcripts},
	}

	out, err := p.Transcribe(context.Background(), "test.mp3")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if got, want := out.Transcript.Text, "hello\nworld\n"; got != want {
		t.Errorf("Transcript.Text = %q, want %q", got, want)
	}
	if len(out.Transcript.Segments) != 2 {
		t.Fatalf("expected 2 segments, got %d", len(out.Transcript.Segments))
	}
	if len(out.Chunks) != 2 {
		t.Fatalf("expected 2 chunks, got %d", len(out.Chunks))
	}
	if out.Chunks[0].Text != "hello" || out.Chunks[1].Text != "world" {
		t.Errorf("unexpected chunk texts: %+v / %+v", out.Chunks[0], out.Chunks[1])
	}
}

func TestPipeline_Transcribe_SplitterError(t *testing.T) {
	p := &Pipeline{
		Splitter:    &mockSplitter{err: errors.New("split failed")},
		Transcriber: &mockTranscriber{},
	}
	if _, err := p.Transcribe(context.Background(), "test.mp3"); err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestPipeline_Transcribe_TranscriberError(t *testing.T) {
	p := &Pipeline{
		Splitter: &mockSplitter{chunks: []splitter.Chunk{{Index: 0, Path: "chunk0.mp3"}}},
		Transcriber: &mockTranscriber{
			err: errors.New("transcribe failed"),
		},
	}
	if _, err := p.Transcribe(context.Background(), "test.mp3"); err == nil {
		t.Fatal("expected error, got nil")
	}
}

// Analyze runs Gemini on pre-computed segments. It must work without the
// splitter or transcriber, mirroring the analyze-retry path on the server.
func TestPipeline_Analyze(t *testing.T) {
	segments := []whisper.Segment{
		{Text: "hello", StartSec: 0, EndSec: 5},
		{Text: "world", StartSec: 5, EndSec: 10},
	}
	analysis := &topic.AnalysisResult{
		Summary: "A short greeting.",
		Topics: []topic.Topic{
			{Index: 0, Title: "Greeting", StartSec: 0, EndSec: 10},
		},
	}

	p := &Pipeline{Analyzer: &mockAnalyzer{result: analysis}}

	out, err := p.Analyze(context.Background(), segments)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out.Summary != "A short greeting." {
		t.Errorf("Summary = %q", out.Summary)
	}
	if len(out.Topics) != 1 {
		t.Fatalf("expected 1 topic, got %d", len(out.Topics))
	}
}

func TestPipeline_Analyze_AnalyzerError(t *testing.T) {
	p := &Pipeline{Analyzer: &mockAnalyzer{err: errors.New("analyze failed")}}
	if _, err := p.Analyze(context.Background(), nil); err == nil {
		t.Fatal("expected error, got nil")
	}
}
