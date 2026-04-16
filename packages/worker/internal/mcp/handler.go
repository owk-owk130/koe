package mcp

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/mark3labs/mcp-go/mcp"

	"github.com/owk-owk130/koe/packages/worker/internal/pipeline"
)

// Runner abstracts pipeline execution for testability.
type Runner interface {
	Run(ctx context.Context, in pipeline.Input) (*pipeline.Result, error)
}

// Handler holds MCP tool handler functions.
type Handler struct {
	TranscribePipeline Runner
	FullPipeline       Runner
}

func extractAudioPath(req mcp.CallToolRequest) (string, error) {
	path, err := req.RequireString("audio_path")
	if err != nil {
		return "", fmt.Errorf("audio_path is required")
	}
	if path == "" {
		return "", fmt.Errorf("audio_path must not be empty")
	}
	return path, nil
}

// HandleTranscribe handles the "transcribe" MCP tool call.
func (h *Handler) HandleTranscribe(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	audioPath, err := extractAudioPath(req)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	result, err := h.TranscribePipeline.Run(ctx, pipeline.Input{AudioPath: audioPath})
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("transcribe failed: %v", err)), nil
	}

	jsonBytes, err := json.Marshal(result.Transcript)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("marshal result: %v", err)), nil
	}

	return mcp.NewToolResultText(string(jsonBytes)), nil
}

// HandleTranscribeSplit handles the "transcribe_split" MCP tool call.
func (h *Handler) HandleTranscribeSplit(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	audioPath, err := extractAudioPath(req)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	result, err := h.FullPipeline.Run(ctx, pipeline.Input{AudioPath: audioPath})
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("transcribe_split failed: %v", err)), nil
	}

	jsonBytes, err := json.Marshal(result)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("marshal result: %v", err)), nil
	}

	return mcp.NewToolResultText(string(jsonBytes)), nil
}
