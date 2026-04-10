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
	topics []topic.Topic
	err    error
}

func (m *mockAnalyzer) Analyze(_ context.Context, _ string, _ []whisper.Segment) ([]topic.Topic, error) {
	return m.topics, m.err
}

// --- tests ---

func TestPipeline_Run(t *testing.T) {
	chunks := []splitter.Chunk{
		{Index: 0, Path: "chunk0.mp3", StartSec: 0, EndSec: 30},
		{Index: 1, Path: "chunk1.mp3", StartSec: 30, EndSec: 60},
	}

	transcripts := map[string]*whisper.Transcript{
		"chunk0.mp3": {
			Text:     "hello world",
			Segments: []whisper.Segment{{Text: "hello world", StartSec: 0, EndSec: 30}},
		},
		"chunk1.mp3": {
			Text:     "goodbye world",
			Segments: []whisper.Segment{{Text: "goodbye world", StartSec: 30, EndSec: 60}},
		},
	}

	topics := []topic.Topic{
		{Index: 0, Title: "Greeting", Summary: "A greeting", StartSec: 0, EndSec: 30},
		{Index: 1, Title: "Farewell", Summary: "A farewell", StartSec: 30, EndSec: 60},
	}

	p := &Pipeline{
		Splitter:    &mockSplitter{chunks: chunks},
		Transcriber: &mockTranscriber{results: transcripts},
		Analyzer:    &mockAnalyzer{topics: topics},
	}

	result, err := p.Run(context.Background(), Input{
		AudioPath: "test.mp3",
		JobID:     "job-1",
		UserID:    "user-1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(result.Transcript.Segments) != 2 {
		t.Errorf("expected 2 segments, got %d", len(result.Transcript.Segments))
	}

	if len(result.Topics) != 2 {
		t.Errorf("expected 2 topics, got %d", len(result.Topics))
	}

	wantText := "hello world\ngoodbye world\n"
	if result.Transcript.Text != wantText {
		t.Errorf("expected text %q, got %q", wantText, result.Transcript.Text)
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
