package whisper

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// Client is an OpenAI-compatible Whisper API client.
// When Model starts with "@cf/", it uses the Workers AI REST API format instead.
type Client struct {
	BaseURL    string
	APIKey     string
	Model      string
	HTTPClient *http.Client
}

type verboseJSONResponse struct {
	Text     string            `json:"text"`
	Segments []segmentResponse `json:"segments"`
}

type segmentResponse struct {
	Text  string  `json:"text"`
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}

type workersAIResponse struct {
	Result  workersAIResult  `json:"result"`
	Success bool             `json:"success"`
	Errors  []workersAIError `json:"errors"`
}

type workersAIResult struct {
	Text     string            `json:"text"`
	Segments []segmentResponse `json:"segments"`
}

type workersAIError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (c *Client) httpClient() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	return http.DefaultClient
}

func (c *Client) isWorkersAI() bool {
	return strings.HasPrefix(c.Model, "@cf/")
}

// Transcribe sends an audio file to the Whisper API and returns the transcript.
func (c *Client) Transcribe(ctx context.Context, audioPath string) (*Transcript, error) {
	if c.isWorkersAI() {
		return c.transcribeWorkersAI(ctx, audioPath)
	}
	return c.transcribeOpenAI(ctx, audioPath)
}

func (c *Client) transcribeOpenAI(ctx context.Context, audioPath string) (*Transcript, error) {
	f, err := os.Open(audioPath)
	if err != nil {
		return nil, fmt.Errorf("open audio file: %w", err)
	}
	defer f.Close()

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)

	part, err := w.CreateFormFile("file", filepath.Base(audioPath))
	if err != nil {
		return nil, fmt.Errorf("create form file: %w", err)
	}
	if _, err := io.Copy(part, f); err != nil {
		return nil, fmt.Errorf("copy audio data: %w", err)
	}

	w.WriteField("model", c.Model)
	w.WriteField("response_format", "verbose_json")
	w.Close()

	url := c.BaseURL + "/v1/audio/transcriptions"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, &buf)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	if c.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}

	resp, err := c.httpClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("whisper API error (status %d): %s", resp.StatusCode, body)
	}

	var result verboseJSONResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return c.toTranscript(&result), nil
}

func (c *Client) transcribeWorkersAI(ctx context.Context, audioPath string) (*Transcript, error) {
	f, err := os.Open(audioPath)
	if err != nil {
		return nil, fmt.Errorf("open audio file: %w", err)
	}
	defer f.Close()

	url := c.BaseURL + "/run/" + c.Model
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, f)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Content-Type", contentTypeFromExt(filepath.Ext(audioPath)))
	if c.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
		req.Header.Set("cf-aig-authorization", "Bearer "+c.APIKey)
	}

	resp, err := c.httpClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("whisper API error (status %d): %s", resp.StatusCode, body)
	}

	var result workersAIResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	if !result.Success {
		msgs := make([]string, len(result.Errors))
		for i, e := range result.Errors {
			msgs[i] = e.Message
		}
		return nil, fmt.Errorf("workers AI error: %s", strings.Join(msgs, "; "))
	}

	return c.toTranscript(&verboseJSONResponse{
		Text:     result.Result.Text,
		Segments: result.Result.Segments,
	}), nil
}

func (c *Client) toTranscript(r *verboseJSONResponse) *Transcript {
	segments := make([]Segment, len(r.Segments))
	for i, s := range r.Segments {
		segments[i] = Segment{
			Text:     s.Text,
			StartSec: s.Start,
			EndSec:   s.End,
		}
	}
	return &Transcript{
		Text:     r.Text,
		Segments: segments,
	}
}

func contentTypeFromExt(ext string) string {
	switch strings.ToLower(ext) {
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	case ".ogg":
		return "audio/ogg"
	case ".flac":
		return "audio/flac"
	case ".m4a":
		return "audio/mp4"
	case ".webm":
		return "audio/webm"
	default:
		return "application/octet-stream"
	}
}
