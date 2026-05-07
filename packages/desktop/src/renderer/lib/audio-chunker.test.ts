import { describe, expect, it } from "vitest";
import { computeChunkRanges, encodeWav } from "./audio-chunker";

describe("computeChunkRanges", () => {
  const sr = 16_000;

  it("returns empty for zero samples", () => {
    expect(computeChunkRanges(0, sr, 60)).toEqual([]);
  });

  it("returns a single range for audio shorter than chunkSec", () => {
    const ranges = computeChunkRanges(30 * sr, sr, 60);
    expect(ranges).toEqual([
      { index: 0, startSample: 0, endSample: 30 * sr, startSec: 0, endSec: 30 },
    ]);
  });

  it("returns a single range when audio is exactly chunkSec long", () => {
    const ranges = computeChunkRanges(60 * sr, sr, 60);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toEqual({
      index: 0,
      startSample: 0,
      endSample: 60 * sr,
      startSec: 0,
      endSec: 60,
    });
  });

  it("splits a 90s buffer into 60s + 30s", () => {
    const ranges = computeChunkRanges(90 * sr, sr, 60);
    expect(ranges).toEqual([
      { index: 0, startSample: 0, endSample: 60 * sr, startSec: 0, endSec: 60 },
      { index: 1, startSample: 60 * sr, endSample: 90 * sr, startSec: 60, endSec: 90 },
    ]);
  });

  it("splits a 150s buffer into 60s + 60s + 30s", () => {
    const ranges = computeChunkRanges(150 * sr, sr, 60);
    expect(ranges).toHaveLength(3);
    expect(ranges[0]).toMatchObject({ startSec: 0, endSec: 60 });
    expect(ranges[1]).toMatchObject({ startSec: 60, endSec: 120 });
    expect(ranges[2]).toMatchObject({ startSec: 120, endSec: 150 });
  });

  it("rejects invalid chunkSec", () => {
    expect(() => computeChunkRanges(sr, sr, 0)).toThrow();
    expect(() => computeChunkRanges(sr, sr, -1)).toThrow();
  });
});

describe("encodeWav", () => {
  const sr = 16_000;

  function readU32LE(view: DataView, offset: number): number {
    return view.getUint32(offset, true);
  }

  function readU16LE(view: DataView, offset: number): number {
    return view.getUint16(offset, true);
  }

  function readAscii(bytes: Uint8Array, offset: number, length: number): string {
    return String.fromCharCode(...bytes.subarray(offset, offset + length));
  }

  it("produces a valid 44-byte RIFF/WAVE header for 1s of silence", () => {
    const samples = new Float32Array(sr);
    const wav = encodeWav({ sampleRate: sr, samples });
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

    expect(readAscii(wav, 0, 4)).toBe("RIFF");
    expect(readAscii(wav, 8, 4)).toBe("WAVE");
    expect(readAscii(wav, 12, 4)).toBe("fmt ");
    expect(readU32LE(view, 16)).toBe(16); // fmt chunk size
    expect(readU16LE(view, 20)).toBe(1); // PCM format
    expect(readU16LE(view, 22)).toBe(1); // mono
    expect(readU32LE(view, 24)).toBe(sr);
    expect(readU16LE(view, 34)).toBe(16); // bits per sample
    expect(readAscii(wav, 36, 4)).toBe("data");

    expect(wav.byteLength).toBe(44 + sr * 2);
    expect(readU32LE(view, 40)).toBe(sr * 2); // data chunk size
    expect(readU32LE(view, 4)).toBe(wav.byteLength - 8); // RIFF size
  });

  it("converts Float32 samples to clipped Int16", () => {
    const samples = new Float32Array([0, 1, -1, 0.5, -0.5, 2, -2]);
    const wav = encodeWav({ sampleRate: sr, samples });
    const view = new DataView(wav.buffer, wav.byteOffset + 44);

    expect(view.getInt16(0, true)).toBe(0);
    expect(view.getInt16(2, true)).toBe(32767); // 1.0 → max
    expect(view.getInt16(4, true)).toBe(-32768); // -1.0 → min
    expect(Math.abs(view.getInt16(6, true) - 16384)).toBeLessThanOrEqual(1); // 0.5
    expect(Math.abs(view.getInt16(8, true) - -16384)).toBeLessThanOrEqual(1);
    expect(view.getInt16(10, true)).toBe(32767); // clipped
    expect(view.getInt16(12, true)).toBe(-32768); // clipped
  });
});
