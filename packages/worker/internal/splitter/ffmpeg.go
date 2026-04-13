package splitter

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// FFmpegSplitter splits audio files using ffmpeg silence detection.
type FFmpegSplitter struct {
	// MaxChunkDuration is the maximum duration of a single chunk in seconds.
	// Defaults to 300 (5 minutes).
	MaxChunkDuration float64
	// SilenceThreshold is the dB threshold for silence detection.
	// Defaults to -30.
	SilenceThreshold int
	// SilenceMinDuration is the minimum silence duration in seconds.
	// Defaults to 0.5.
	SilenceMinDuration float64
}

type silence struct {
	Start float64
	End   float64
}

var (
	reSilenceStart = regexp.MustCompile(`silence_start:\s*([\d.]+)`)
	reSilenceEnd   = regexp.MustCompile(`silence_end:\s*([\d.]+)`)
)

func parseSilenceDetect(output string) []silence {
	var silences []silence
	var current *silence

	for _, line := range strings.Split(output, "\n") {
		if m := reSilenceStart.FindStringSubmatch(line); m != nil {
			v, _ := strconv.ParseFloat(m[1], 64)
			current = &silence{Start: v}
		} else if m := reSilenceEnd.FindStringSubmatch(line); m != nil && current != nil {
			v, _ := strconv.ParseFloat(m[1], 64)
			current.End = v
			silences = append(silences, *current)
			current = nil
		}
	}

	return silences
}

// computeSplitPoints returns timestamps where the audio should be split.
// It prefers splitting at silence midpoints but falls back to maxDuration boundaries.
// Only silences in the latter half of each window are considered to avoid overly short chunks.
func computeSplitPoints(duration float64, silences []silence, maxDuration float64) []float64 {
	if duration <= maxDuration {
		return nil
	}

	var points []float64
	pos := 0.0

	for pos+maxDuration < duration {
		deadline := pos + maxDuration
		minSplit := pos + maxDuration/2

		// Find the best silence: closest to deadline, but at least halfway through the window.
		bestPoint := -1.0
		for _, s := range silences {
			mid := (s.Start + s.End) / 2
			if mid <= pos {
				continue
			}
			if s.Start > deadline {
				break
			}
			if mid >= minSplit {
				bestPoint = mid
			}
		}

		if bestPoint > pos {
			points = append(points, bestPoint)
			pos = bestPoint
		} else {
			points = append(points, deadline)
			pos = deadline
		}
	}

	return points
}

func (s *FFmpegSplitter) maxDuration() float64 {
	if s.MaxChunkDuration > 0 {
		return s.MaxChunkDuration
	}
	return 300
}

func (s *FFmpegSplitter) silenceThreshold() int {
	if s.SilenceThreshold != 0 {
		return s.SilenceThreshold
	}
	return -30
}

func (s *FFmpegSplitter) silenceMinDuration() float64 {
	if s.SilenceMinDuration > 0 {
		return s.SilenceMinDuration
	}
	return 0.5
}

// Split implements the Splitter interface.
func (s *FFmpegSplitter) Split(ctx context.Context, audioPath string) ([]Chunk, error) {
	// 1. Get audio duration
	duration, err := probeDuration(ctx, audioPath)
	if err != nil {
		return nil, fmt.Errorf("probe duration: %w", err)
	}

	// 2. Detect silences
	silences, err := detectSilences(ctx, audioPath, s.silenceThreshold(), s.silenceMinDuration())
	if err != nil {
		return nil, fmt.Errorf("detect silences: %w", err)
	}

	// 3. Compute split points
	points := computeSplitPoints(duration, silences, s.maxDuration())

	// 4. If no splits needed, return the original file as a single chunk
	if len(points) == 0 {
		return []Chunk{{
			Index:    0,
			Path:     audioPath,
			StartSec: 0,
			EndSec:   duration,
		}}, nil
	}

	// 5. Create temp directory for chunks
	tmpDir, err := os.MkdirTemp("", "koe-chunks-*")
	if err != nil {
		return nil, fmt.Errorf("create temp dir: %w", err)
	}

	// 6. Split at each point
	boundaries := make([]float64, 0, len(points)+2)
	boundaries = append(boundaries, 0)
	boundaries = append(boundaries, points...)
	boundaries = append(boundaries, duration)

	ext := filepath.Ext(audioPath)
	chunks := make([]Chunk, 0, len(boundaries)-1)

	for i := range len(boundaries) - 1 {
		start := boundaries[i]
		end := boundaries[i+1]
		outPath := filepath.Join(tmpDir, fmt.Sprintf("chunk_%03d%s", i, ext))

		err := extractSegment(ctx, audioPath, outPath, start, end-start)
		if err != nil {
			return nil, fmt.Errorf("extract chunk %d: %w", i, err)
		}

		chunks = append(chunks, Chunk{
			Index:    i,
			Path:     outPath,
			StartSec: start,
			EndSec:   end,
		})
	}

	return chunks, nil
}

func probeDuration(ctx context.Context, audioPath string) (float64, error) {
	cmd := exec.CommandContext(ctx, "ffprobe",
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1",
		audioPath,
	)
	out, err := cmd.Output()
	if err != nil {
		return 0, fmt.Errorf("ffprobe: %w", err)
	}
	return strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
}

func detectSilences(ctx context.Context, audioPath string, threshold int, minDuration float64) ([]silence, error) {
	filter := fmt.Sprintf("silencedetect=noise=%ddB:d=%.1f", threshold, minDuration)
	cmd := exec.CommandContext(ctx, "ffmpeg",
		"-i", audioPath,
		"-af", filter,
		"-f", "null", "-",
	)
	// silencedetect outputs to stderr
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("ffmpeg silencedetect: %w\n%s", err, out)
	}
	return parseSilenceDetect(string(out)), nil
}

func extractSegment(ctx context.Context, audioPath, outPath string, start, duration float64) error {
	cmd := exec.CommandContext(ctx, "ffmpeg",
		"-y",
		"-ss", fmt.Sprintf("%.3f", start),
		"-i", audioPath,
		"-t", fmt.Sprintf("%.3f", duration),
		"-c", "copy",
		"-v", "error",
		outPath,
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("ffmpeg extract: %w\n%s", err, out)
	}
	return nil
}
