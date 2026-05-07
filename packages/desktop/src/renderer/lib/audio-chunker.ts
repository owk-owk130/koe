export interface ChunkRange {
  index: number;
  startSample: number;
  endSample: number;
  startSec: number;
  endSec: number;
}

export interface PCMChunk {
  sampleRate: number;
  samples: Float32Array;
}

export interface AudioChunk {
  index: number;
  blob: Blob;
  startSec: number;
  endSec: number;
}

export interface ChunkAudioBlobOptions {
  chunkDurationSec?: number;
  targetSampleRate?: number;
}

const DEFAULT_CHUNK_DURATION_SEC = 60;
// Whisper performs well on 16kHz mono. Downsampling here cuts upload size dramatically.
const DEFAULT_TARGET_SAMPLE_RATE = 16_000;

export function computeChunkRanges(
  totalSamples: number,
  sampleRate: number,
  chunkDurationSec: number,
): ChunkRange[] {
  if (chunkDurationSec <= 0) {
    throw new Error("chunkDurationSec must be > 0");
  }
  if (totalSamples <= 0) return [];

  const chunkSamples = Math.round(chunkDurationSec * sampleRate);
  const ranges: ChunkRange[] = [];
  let cursor = 0;
  let index = 0;
  while (cursor < totalSamples) {
    const startSample = cursor;
    const endSample = Math.min(cursor + chunkSamples, totalSamples);
    ranges.push({
      index,
      startSample,
      endSample,
      startSec: startSample / sampleRate,
      endSec: endSample / sampleRate,
    });
    cursor = endSample;
    index += 1;
  }
  return ranges;
}

export function encodeWav(chunk: PCMChunk): Uint8Array<ArrayBuffer> {
  const { sampleRate, samples } = chunk;
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const intSample = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    view.setInt16(offset, intSample, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

// Browser-only orchestrator: decode → resample to mono target rate → slice → encode WAV.
// Not unit-tested in node because Web Audio APIs aren't available; covered by Phase 6 E2E.
export async function chunkAudioBlob(
  blob: Blob,
  options: ChunkAudioBlobOptions = {},
): Promise<AudioChunk[]> {
  const chunkDurationSec = options.chunkDurationSec ?? DEFAULT_CHUNK_DURATION_SEC;
  const targetSampleRate = options.targetSampleRate ?? DEFAULT_TARGET_SAMPLE_RATE;

  const arrayBuffer = await blob.arrayBuffer();
  const decodeCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    void decodeCtx.close();
  }

  const mono = await resampleToMono(decoded, targetSampleRate);
  const ranges = computeChunkRanges(mono.length, targetSampleRate, chunkDurationSec);

  return ranges.map((range) => {
    const segment = mono.subarray(range.startSample, range.endSample);
    const wav = encodeWav({ sampleRate: targetSampleRate, samples: segment });
    return {
      index: range.index,
      blob: new Blob([wav], { type: "audio/wav" }),
      startSec: range.startSec,
      endSec: range.endSec,
    };
  });
}

async function resampleToMono(
  buffer: AudioBuffer,
  targetSampleRate: number,
): Promise<Float32Array> {
  const targetLength = Math.ceil((buffer.duration * targetSampleRate) / 1);
  const offline = new OfflineAudioContext(1, targetLength, targetSampleRate);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}
