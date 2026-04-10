package storage

import (
	"context"
	"io"
)

// Storage provides read/write access to audio files and results.
type Storage interface {
	Upload(ctx context.Context, key string, r io.Reader) error
	Download(ctx context.Context, key string) (io.ReadCloser, error)
	UploadJSON(ctx context.Context, key string, v any) error
	DownloadJSON(ctx context.Context, key string, v any) error
}
