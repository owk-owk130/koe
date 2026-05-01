import { describe, expect, it } from "vitest";
import { formatDuration, formatDate, formatFileSize, statusLabel } from "./format";

describe("formatDuration", () => {
  it("formats seconds to mm:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(5)).toBe("0:05");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(600)).toBe("10:00");
  });

  it("formats to h:mm:ss for durations >= 1 hour", () => {
    expect(formatDuration(3600)).toBe("1:00:00");
    expect(formatDuration(3661)).toBe("1:01:01");
    expect(formatDuration(7200)).toBe("2:00:00");
  });

  it("handles null and undefined", () => {
    expect(formatDuration(null)).toBe("--:--");
    expect(formatDuration(undefined)).toBe("--:--");
  });
});

describe("formatDate", () => {
  it("formats ISO date string to locale date", () => {
    const result = formatDate("2025-01-15T10:30:00Z");
    expect(result).toMatch(/2025/);
    expect(result).toMatch(/1/);
    expect(result).toMatch(/15/);
  });

  it("handles null and undefined", () => {
    expect(formatDate(null)).toBe("--");
    expect(formatDate(undefined)).toBe("--");
  });
});

describe("formatFileSize", () => {
  it("formats bytes to human-readable", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(1048576)).toBe("1.0 MB");
    expect(formatFileSize(1073741824)).toBe("1.0 GB");
  });
});

describe("statusLabel", () => {
  it("returns Japanese labels for each status", () => {
    expect(statusLabel("pending")).toBe("待機中");
    expect(statusLabel("processing")).toBe("処理中");
    expect(statusLabel("completed")).toBe("完了");
    expect(statusLabel("failed")).toBe("失敗");
  });

  it("labels phase-aware statuses produced by the two-phase orchestrator", () => {
    expect(statusLabel("transcribing")).toBe("文字起こし中");
    expect(statusLabel("transcribed")).toBe("文字起こし完了");
    expect(statusLabel("analyzing")).toBe("要約中");
    expect(statusLabel("transcribe_failed")).toBe("文字起こし失敗");
    expect(statusLabel("analyze_failed")).toBe("要約失敗");
  });

  it("returns the status as-is for unknown values", () => {
    expect(statusLabel("unknown")).toBe("unknown");
  });
});
