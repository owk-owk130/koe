package pipeline

import (
	"context"
	"errors"
	"testing"

	"github.com/owk-owk130/koe/packages/worker/internal/splitter"
	"github.com/owk-owk130/koe/packages/worker/internal/whisper"
)

// --- mocks ---

type mockSplitter struct {
	chunks       []splitter.Chunk
	err          error
	cleanupCalls int
}

func (m *mockSplitter) Split(_ context.Context, _ string) ([]splitter.Chunk, error) {
	return m.chunks, m.err
}

func (m *mockSplitter) Cleanup(_ []splitter.Chunk) error {
	m.cleanupCalls++
	return nil
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

// --- tests ---

// Transcribe is the standalone Whisper-only step used by the orchestrator to
// persist intermediate output before invoking Gemini on the Workers TS side.
func TestPipeline_Transcribe(t *testing.T) {
	chunks := []splitter.Chunk{
		{Index: 0, Path: "chunk0.mp3", StartSec: 0, EndSec: 30},
		{Index: 1, Path: "chunk1.mp3", StartSec: 30, EndSec: 60},
	}
	// Whisper returns chunk-local timestamps (each chunk's first segment starts
	// at 0). The pipeline must shift them onto the global timeline.
	transcripts := map[string]*whisper.Transcript{
		"chunk0.mp3": {
			Text: "hello",
			Segments: []whisper.Segment{
				{Text: "hello", StartSec: 0, EndSec: 5},
			},
		},
		"chunk1.mp3": {
			Text: "world",
			Segments: []whisper.Segment{
				{Text: "world", StartSec: 0, EndSec: 5},
			},
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
	// chunk0 segment stays at 0-5 because chunk.StartSec=0.
	// chunk1 segment must be shifted by +30s onto the global timeline.
	wantSegmentTimes := []struct{ start, end float64 }{
		{0, 5}, {30, 35},
	}
	for i, want := range wantSegmentTimes {
		got := out.Transcript.Segments[i]
		if got.StartSec != want.start || got.EndSec != want.end {
			t.Errorf("segment[%d] times = (%v,%v), want (%v,%v)",
				i, got.StartSec, got.EndSec, want.start, want.end)
		}
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

// Whether Whisper succeeds or fails, the chunk temp files the splitter created
// must be cleaned up so the long-running container doesn't accumulate
// per-request leftovers.
func TestPipeline_Transcribe_CleansUpChunksOnSuccess(t *testing.T) {
	chunks := []splitter.Chunk{{Index: 0, Path: "chunk0.mp3", StartSec: 0, EndSec: 30}}
	transcripts := map[string]*whisper.Transcript{
		"chunk0.mp3": {Text: "ok", Segments: []whisper.Segment{{Text: "ok"}}},
	}
	splitterMock := &mockSplitter{chunks: chunks}
	p := &Pipeline{Splitter: splitterMock, Transcriber: &mockTranscriber{results: transcripts}}

	if _, err := p.Transcribe(context.Background(), "test.mp3"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if splitterMock.cleanupCalls != 1 {
		t.Errorf("expected Cleanup to be called once, got %d", splitterMock.cleanupCalls)
	}
}

func TestPipeline_Transcribe_CleansUpChunksOnTranscribeError(t *testing.T) {
	splitterMock := &mockSplitter{chunks: []splitter.Chunk{{Index: 0, Path: "chunk0.mp3"}}}
	p := &Pipeline{
		Splitter:    splitterMock,
		Transcriber: &mockTranscriber{err: errors.New("transcribe failed")},
	}
	_, _ = p.Transcribe(context.Background(), "test.mp3")
	if splitterMock.cleanupCalls != 1 {
		t.Errorf("expected Cleanup to be called once even on error, got %d", splitterMock.cleanupCalls)
	}
}
