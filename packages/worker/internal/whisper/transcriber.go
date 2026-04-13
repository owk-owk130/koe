package whisper

import "context"

// Segment represents a timestamped transcription segment.
type Segment struct {
	Text     string  `json:"text"`
	StartSec float64 `json:"start_sec"`
	EndSec   float64 `json:"end_sec"`
}

// Transcript represents the result of transcribing an audio file.
type Transcript struct {
	Text     string    `json:"text"`
	Segments []Segment `json:"segments"`
}

// Transcriber transcribes audio files to text.
type Transcriber interface {
	Transcribe(ctx context.Context, audioPath string) (*Transcript, error)
}
