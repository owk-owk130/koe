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
	// FFmpegPath is the path to the ffmpeg binary. Defaults to "ffmpeg" (system PATH).
	FFmpegPath string
	// FFprobePath is the path to the ffprobe binary. Defaults to "ffprobe" (system PATH).
	FFprobePath string
}

type silence struct {
	Start float64
	End   float64
}

var (
	reSilenceStart = regexp.MustCompile(`silence_start:\s*([\d.]+)`)
	reSilenceEnd   = regexp.MustCompile(`silence_end:\s*([\d.]+)`)
	reTime         = regexp.MustCompile(`time=(\d+):(\d+):([\d.]+)`)
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

func (s *FFmpegSplitter) ffmpegPath() string {
	if s.FFmpegPath != "" {
		return s.FFmpegPath
	}
	return "ffmpeg"
}

func (s *FFmpegSplitter) ffprobePath() string {
	if s.FFprobePath != "" {
		return s.FFprobePath
	}
	return "ffprobe"
}

// Split implements the Splitter interface.
func (s *FFmpegSplitter) Split(ctx context.Context, audioPath string) ([]Chunk, error) {
	// 1. Get audio duration
	duration, err := s.probeDuration(ctx, audioPath)
	if err != nil {
		return nil, fmt.Errorf("probe duration: %w", err)
	}

	// 2. Detect silences
	silences, err := s.detectSilences(ctx, audioPath, s.silenceThreshold(), s.silenceMinDuration())
	if err != nil {
		return nil, fmt.Errorf("detect silences: %w", err)
	}

	// 3. Compute split points
	points := computeSplitPoints(duration, silences, s.maxDuration())

	// 4. If no splits needed, convert to mp3 and return as a single chunk
	if len(points) == 0 {
		if filepath.Ext(audioPath) == ".mp3" {
			return []Chunk{{
				Index:    0,
				Path:     audioPath,
				StartSec: 0,
				EndSec:   duration,
			}}, nil
		}
		tmpFile, err := os.CreateTemp("", "koe-converted-*.mp3")
		if err != nil {
			return nil, fmt.Errorf("create temp file: %w", err)
		}
		tmpFile.Close()
		if err := s.extractSegment(ctx, audioPath, tmpFile.Name(), 0, duration); err != nil {
			os.Remove(tmpFile.Name())
			return nil, fmt.Errorf("convert to mp3: %w", err)
		}
		return []Chunk{{
			Index:    0,
			Path:     tmpFile.Name(),
			StartSec: 0,
			EndSec:   duration,
		}}, nil
	}

	// 5. Create temp directory for chunks
	tmpDir, err := os.MkdirTemp("", "koe-chunks-*")
	if err != nil {
		return nil, fmt.Errorf("create temp dir: %w", err)
	}
	cleanupTmpDir := true
	defer func() {
		if cleanupTmpDir {
			os.RemoveAll(tmpDir)
		}
	}()

	// 6. Split at each point
	boundaries := make([]float64, 0, len(points)+2)
	boundaries = append(boundaries, 0)
	boundaries = append(boundaries, points...)
	boundaries = append(boundaries, duration)

	chunks := make([]Chunk, 0, len(boundaries)-1)

	for i := range len(boundaries) - 1 {
		start := boundaries[i]
		end := boundaries[i+1]
		outPath := filepath.Join(tmpDir, fmt.Sprintf("chunk_%03d.mp3", i))

		err := s.extractSegment(ctx, audioPath, outPath, start, end-start)
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

	cleanupTmpDir = false // caller owns the chunks now
	return chunks, nil
}

func (s *FFmpegSplitter) probeDuration(ctx context.Context, audioPath string) (float64, error) {
	cmd := exec.CommandContext(ctx, s.ffprobePath(),
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1",
		audioPath,
	)
	out, err := cmd.Output()
	if err != nil {
		return 0, fmt.Errorf("ffprobe: %w", err)
	}

	raw := strings.TrimSpace(string(out))
	if d, err := strconv.ParseFloat(raw, 64); err == nil {
		return d, nil
	}

	// Fallback: decode to get duration when container metadata lacks it (e.g. some WebM files)
	return s.probeDurationByDecode(ctx, audioPath)
}

func (s *FFmpegSplitter) probeDurationByDecode(ctx context.Context, audioPath string) (float64, error) {
	cmd := exec.CommandContext(ctx, s.ffmpegPath(),
		"-i", audioPath,
		"-f", "null",
		"-v", "quiet",
		"-stats",
		"-",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return 0, fmt.Errorf("ffmpeg decode for duration: %w", err)
	}
	return parseFfmpegTime(string(out))
}

func parseFfmpegTime(output string) (float64, error) {
	matches := reTime.FindAllStringSubmatch(output, -1)
	if len(matches) == 0 {
		return 0, fmt.Errorf("could not determine audio duration")
	}
	last := matches[len(matches)-1]
	h, _ := strconv.ParseFloat(last[1], 64)
	m, _ := strconv.ParseFloat(last[2], 64)
	s, _ := strconv.ParseFloat(last[3], 64)
	return h*3600 + m*60 + s, nil
}

func (s *FFmpegSplitter) detectSilences(ctx context.Context, audioPath string, threshold int, minDuration float64) ([]silence, error) {
	filter := fmt.Sprintf("silencedetect=noise=%ddB:d=%.1f", threshold, minDuration)
	cmd := exec.CommandContext(ctx, s.ffmpegPath(),
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

func (s *FFmpegSplitter) extractSegment(ctx context.Context, audioPath, outPath string, start, duration float64) error {
	cmd := exec.CommandContext(ctx, s.ffmpegPath(),
		"-y",
		"-ss", fmt.Sprintf("%.3f", start),
		"-i", audioPath,
		"-t", fmt.Sprintf("%.3f", duration),
		"-v", "error",
		outPath,
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("ffmpeg extract: %w\n%s", err, out)
	}
	return nil
}
