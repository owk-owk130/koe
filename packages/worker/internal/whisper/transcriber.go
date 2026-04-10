package whisper

import "context"

// Segment represents a timestamped transcription segment.
type Segment struct {
	Text     string
	StartSec float64
	EndSec   float64
}

// Transcript represents the result of transcribing an audio file.
type Transcript struct {
	Text     string
	Segments []Segment
}

// Transcriber transcribes audio files to text.
type Transcriber interface {
	Transcribe(ctx context.Context, audioPath string) (*Transcript, error)
}
