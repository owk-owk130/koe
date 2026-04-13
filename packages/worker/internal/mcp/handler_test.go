package mcp_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/mark3labs/mcp-go/mcp"

	handler "github.com/owk-owk130/koe/packages/worker/internal/mcp"
	"github.com/owk-owk130/koe/packages/worker/internal/pipeline"
	"github.com/owk-owk130/koe/packages/worker/internal/topic"
	"github.com/owk-owk130/koe/packages/worker/internal/whisper"
)

// --- mocks ---

type mockRunner struct {
	result *pipeline.Result
	err    error
}

func (m *mockRunner) Run(_ context.Context, _ pipeline.Input) (*pipeline.Result, error) {
	return m.result, m.err
}

// --- transcribe tests ---

func TestHandleTranscribe_Success(t *testing.T) {
	want := &pipeline.Result{
		Transcript: whisper.Transcript{
			Text: "hello world",
			Segments: []whisper.Segment{
				{Text: "hello world", StartSec: 0, EndSec: 2.5},
			},
		},
	}

	h := &handler.Handler{
		TranscribePipeline: &mockRunner{result: want},
	}

	req := mcp.CallToolRequest{}
	req.Params.Arguments = map[string]any{
		"audio_path": "/tmp/test.mp3",
	}

	result, err := h.HandleTranscribe(context.Background(), req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Fatalf("expected success, got error result")
	}
	if len(result.Content) == 0 {
		t.Fatal("expected content in result")
	}

	textContent, ok := result.Content[0].(mcp.TextContent)
	if !ok {
		t.Fatalf("expected TextContent, got %T", result.Content[0])
	}

	var got whisper.Transcript
	if err := json.Unmarshal([]byte(textContent.Text), &got); err != nil {
		t.Fatalf("failed to unmarshal result JSON: %v", err)
	}
	if got.Text != want.Transcript.Text {
		t.Errorf("text = %q, want %q", got.Text, want.Transcript.Text)
	}
	if len(got.Segments) != 1 {
		t.Fatalf("segments count = %d, want 1", len(got.Segments))
	}
	if got.Segments[0].EndSec != 2.5 {
		t.Errorf("segment end = %f, want 2.5", got.Segments[0].EndSec)
	}
}

func TestHandleTranscribe_MissingAudioPath(t *testing.T) {
	h := &handler.Handler{
		TranscribePipeline: &mockRunner{},
	}

	req := mcp.CallToolRequest{}
	req.Params.Arguments = map[string]any{}

	result, err := h.HandleTranscribe(context.Background(), req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Fatal("expected error result for missing audio_path")
	}
}

func TestHandleTranscribe_PipelineError(t *testing.T) {
	h := &handler.Handler{
		TranscribePipeline: &mockRunner{err: errors.New("ffmpeg not found")},
	}

	req := mcp.CallToolRequest{}
	req.Params.Arguments = map[string]any{
		"audio_path": "/tmp/test.mp3",
	}

	result, err := h.HandleTranscribe(context.Background(), req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Fatal("expected error result for pipeline failure")
	}

	textContent, ok := result.Content[0].(mcp.TextContent)
	if !ok {
		t.Fatalf("expected TextContent, got %T", result.Content[0])
	}
	if textContent.Text == "" {
		t.Error("expected error message in content")
	}
}

// --- transcribe_split tests ---

func TestHandleTranscribeSplit_Success(t *testing.T) {
	want := &pipeline.Result{
		Transcript: whisper.Transcript{
			Text: "hello world. goodbye world.",
			Segments: []whisper.Segment{
				{Text: "hello world.", StartSec: 0, EndSec: 2.5},
				{Text: "goodbye world.", StartSec: 2.5, EndSec: 5.0},
			},
		},
		Topics: []topic.Topic{
			{
				Index:      0,
				Title:      "Greeting",
				Summary:    "A greeting",
				StartSec:   0,
				EndSec:     2.5,
				Transcript: "hello world.",
			},
			{
				Index:      1,
				Title:      "Farewell",
				Summary:    "A farewell",
				StartSec:   2.5,
				EndSec:     5.0,
				Transcript: "goodbye world.",
			},
		},
	}

	h := &handler.Handler{
		FullPipeline: &mockRunner{result: want},
	}

	req := mcp.CallToolRequest{}
	req.Params.Arguments = map[string]any{
		"audio_path": "/tmp/test.mp3",
	}

	result, err := h.HandleTranscribeSplit(context.Background(), req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Fatalf("expected success, got error result")
	}
	if len(result.Content) == 0 {
		t.Fatal("expected content in result")
	}

	textContent, ok := result.Content[0].(mcp.TextContent)
	if !ok {
		t.Fatalf("expected TextContent, got %T", result.Content[0])
	}

	var got pipeline.Result
	if err := json.Unmarshal([]byte(textContent.Text), &got); err != nil {
		t.Fatalf("failed to unmarshal result JSON: %v", err)
	}
	if got.Transcript.Text != want.Transcript.Text {
		t.Errorf("text = %q, want %q", got.Transcript.Text, want.Transcript.Text)
	}
	if len(got.Topics) != 2 {
		t.Fatalf("topics count = %d, want 2", len(got.Topics))
	}
	if got.Topics[0].Title != "Greeting" {
		t.Errorf("topic[0].title = %q, want %q", got.Topics[0].Title, "Greeting")
	}
	if got.Topics[1].Title != "Farewell" {
		t.Errorf("topic[1].title = %q, want %q", got.Topics[1].Title, "Farewell")
	}
}

func TestHandleTranscribeSplit_MissingAudioPath(t *testing.T) {
	h := &handler.Handler{
		FullPipeline: &mockRunner{},
	}

	req := mcp.CallToolRequest{}
	req.Params.Arguments = map[string]any{}

	result, err := h.HandleTranscribeSplit(context.Background(), req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Fatal("expected error result for missing audio_path")
	}
}

func TestHandleTranscribeSplit_PipelineError(t *testing.T) {
	h := &handler.Handler{
		FullPipeline: &mockRunner{err: errors.New("gemini API error")},
	}

	req := mcp.CallToolRequest{}
	req.Params.Arguments = map[string]any{
		"audio_path": "/tmp/test.mp3",
	}

	result, err := h.HandleTranscribeSplit(context.Background(), req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Fatal("expected error result for pipeline failure")
	}

	textContent, ok := result.Content[0].(mcp.TextContent)
	if !ok {
		t.Fatalf("expected TextContent, got %T", result.Content[0])
	}
	if textContent.Text == "" {
		t.Error("expected error message in content")
	}
}
