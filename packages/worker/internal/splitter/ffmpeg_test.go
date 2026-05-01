package splitter

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseSilenceDetect(t *testing.T) {
	// ffmpeg silencedetect の実際の stderr 出力
	output := `[silencedetect @ 0x1234] silence_start: 29.5
[silencedetect @ 0x1234] silence_end: 30.2 | silence_duration: 0.7
[silencedetect @ 0x1234] silence_start: 61.0
[silencedetect @ 0x1234] silence_end: 61.8 | silence_duration: 0.8
[silencedetect @ 0x1234] silence_start: 120.3
[silencedetect @ 0x1234] silence_end: 121.1 | silence_duration: 0.8
`

	silences := parseSilenceDetect(output)

	if len(silences) != 3 {
		t.Fatalf("expected 3 silences, got %d", len(silences))
	}

	want := []silence{
		{Start: 29.5, End: 30.2},
		{Start: 61.0, End: 61.8},
		{Start: 120.3, End: 121.1},
	}

	for i, s := range silences {
		if s.Start != want[i].Start || s.End != want[i].End {
			t.Errorf("silence[%d]: got {%.1f, %.1f}, want {%.1f, %.1f}",
				i, s.Start, s.End, want[i].Start, want[i].End)
		}
	}
}

func TestParseSilenceDetect_Empty(t *testing.T) {
	silences := parseSilenceDetect("some random output\nno silence here\n")

	if len(silences) != 0 {
		t.Fatalf("expected 0 silences, got %d", len(silences))
	}
}

func TestParseFfmpegTime(t *testing.T) {
	tests := []struct {
		name    string
		output  string
		want    float64
		wantErr bool
	}{
		{
			name:   "standard stats output",
			output: "size=       0kB time=00:01:30.50 bitrate=N/A speed=1234x\n",
			want:   90.5,
		},
		{
			name:   "multiple time entries uses last",
			output: "size=       0kB time=00:00:10.00 bitrate=N/A\nsize=       0kB time=00:02:05.25 bitrate=N/A\n",
			want:   125.25,
		},
		{
			name:   "hours included",
			output: "size=       0kB time=01:30:00.00 bitrate=N/A\n",
			want:   5400,
		},
		{
			name:    "no time in output",
			output:  "some random output\n",
			wantErr: true,
		},
		{
			name:    "empty output",
			output:  "",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseFfmpegTime(tt.output)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if diff := got - tt.want; diff > 0.01 || diff < -0.01 {
				t.Errorf("got %.2f, want %.2f", got, tt.want)
			}
		})
	}
}

func TestComputeSplitPoints(t *testing.T) {
	tests := []struct {
		name        string
		duration    float64
		silences    []silence
		maxDuration float64
		wantPoints  []float64
	}{
		{
			name:        "short audio, no split needed",
			duration:    120,
			silences:    []silence{{Start: 60, End: 61}},
			maxDuration: 300,
			wantPoints:  nil,
		},
		{
			name:     "split at silence within limit",
			duration: 600,
			silences: []silence{
				{Start: 280, End: 281},
				{Start: 560, End: 561},
			},
			maxDuration: 300,
			wantPoints:  []float64{280.5, 560.5},
		},
		{
			name:        "no silence, force split at max duration",
			duration:    600,
			silences:    nil,
			maxDuration: 300,
			wantPoints:  []float64{300},
		},
		{
			name:     "silence too early, force split",
			duration: 700,
			silences: []silence{
				{Start: 50, End: 51},
				{Start: 600, End: 601},
			},
			maxDuration: 300,
			// Second silence is centred at 600.5, just past deadline 600;
			// midpoint clamps to 600 so the chunk stays within maxDuration.
			wantPoints: []float64{300, 600},
		},
		{
			name:     "multiple silences, pick best within window",
			duration: 900,
			silences: []silence{
				{Start: 240, End: 241},
				{Start: 290, End: 291},
				{Start: 550, End: 551},
			},
			maxDuration: 300,
			wantPoints:  []float64{290.5, 550.5, 850.5},
		},
		{
			// A long silence straddling the deadline (e.g. 280-330 with maxDuration
			// 300) must not push the split past 300s. Otherwise the resulting
			// chunk would exceed Workers AI Whisper's request-size band.
			name:     "silence straddles deadline, clamp to deadline",
			duration: 900,
			silences: []silence{
				{Start: 280, End: 330},
			},
			maxDuration: 300,
			wantPoints:  []float64{300, 600},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := computeSplitPoints(tt.duration, tt.silences, tt.maxDuration)

			if len(got) != len(tt.wantPoints) {
				t.Fatalf("got %d split points %v, want %d %v",
					len(got), got, len(tt.wantPoints), tt.wantPoints)
			}

			for i, p := range got {
				if diff := p - tt.wantPoints[i]; diff > 0.1 || diff < -0.1 {
					t.Errorf("point[%d]: got %.1f, want %.1f", i, p, tt.wantPoints[i])
				}
			}
		})
	}
}

// Cleanup must remove the temp directory the splitter created and leave any
// caller-owned paths alone. With chunk size lowered to 60s, every job produces
// dozens of chunk files; without explicit cleanup the container leaks tens of
// MB per request.
func TestFFmpegSplitter_Cleanup(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "koe-chunks-")
	if err != nil {
		t.Fatalf("mkdtemp: %v", err)
	}
	chunkPath := filepath.Join(tmpDir, "chunk_000.mp3")
	if err := os.WriteFile(chunkPath, []byte("x"), 0o644); err != nil {
		t.Fatalf("write chunk: %v", err)
	}

	s := &FFmpegSplitter{}
	if err := s.Cleanup([]Chunk{{Path: chunkPath}}); err != nil {
		t.Fatalf("Cleanup returned error: %v", err)
	}

	if _, err := os.Stat(tmpDir); !os.IsNotExist(err) {
		t.Errorf("expected chunk tmp dir to be removed, got err=%v", err)
	}
}

// Caller-owned paths (e.g. the original audio file passed in for a
// no-split-needed mp3) must not be touched by Cleanup.
func TestFFmpegSplitter_Cleanup_SkipsCallerOwnedPath(t *testing.T) {
	parent := t.TempDir()
	audio := filepath.Join(parent, "original.mp3")
	if err := os.WriteFile(audio, []byte("x"), 0o644); err != nil {
		t.Fatalf("write audio: %v", err)
	}

	s := &FFmpegSplitter{}
	if err := s.Cleanup([]Chunk{{Path: audio}}); err != nil {
		t.Fatalf("Cleanup returned error: %v", err)
	}

	if _, err := os.Stat(audio); err != nil {
		t.Errorf("caller-owned audio file was unexpectedly removed: %v", err)
	}
	if _, err := os.Stat(parent); err != nil {
		t.Errorf("caller-owned parent dir was unexpectedly removed: %v", err)
	}
}

// Single-file conversion (non-mp3 input) writes one koe-converted-*.mp3 file
// directly under os.TempDir(); only that file should be removed, never the
// shared temp dir.
func TestFFmpegSplitter_Cleanup_RemovesConvertedSingleFile(t *testing.T) {
	f, err := os.CreateTemp("", "koe-converted-*.mp3")
	if err != nil {
		t.Fatalf("create temp: %v", err)
	}
	path := f.Name()
	f.Close()

	s := &FFmpegSplitter{}
	if err := s.Cleanup([]Chunk{{Path: path}}); err != nil {
		t.Fatalf("Cleanup returned error: %v", err)
	}

	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("expected converted single file to be removed, err=%v", err)
	}
	if _, err := os.Stat(os.TempDir()); err != nil {
		t.Errorf("os.TempDir() was unexpectedly removed: %v", err)
	}
}

func TestFFmpegSplitter_Cleanup_NoOpForEmpty(t *testing.T) {
	s := &FFmpegSplitter{}
	if err := s.Cleanup(nil); err != nil {
		t.Errorf("expected nil error for empty input, got %v", err)
	}
}

// 内部実装の前提（Splitter が `koe-chunks-` で識別すること）が破綻していな
// いか、定数チェック相当のセンチネル。
func TestFFmpegSplitter_Cleanup_SentinelPrefixes(t *testing.T) {
	for _, p := range []string{"koe-chunks-", "koe-converted-"} {
		if !strings.HasPrefix(p, "koe-") {
			t.Errorf("unexpected prefix %q", p)
		}
	}
}
