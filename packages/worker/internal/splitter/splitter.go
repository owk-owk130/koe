package splitter

import "context"

// Chunk represents a split audio segment.
type Chunk struct {
	Index    int
	Path     string
	StartSec float64
	EndSec   float64
}

// Splitter splits an audio file into chunks.
type Splitter interface {
	Split(ctx context.Context, audioPath string) ([]Chunk, error)
	// Cleanup removes any temporary files / directories the implementation
	// created during Split. Caller-owned paths (e.g. the original audio file
	// passed in for a no-split-needed pass-through) must not be touched.
	Cleanup(chunks []Chunk) error
}
