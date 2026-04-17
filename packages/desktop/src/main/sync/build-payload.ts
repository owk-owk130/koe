import type { Chunk, Job, Topic } from "~/main/db/schema";

export type SyncPayload = {
  audio_filename: string;
  transcript: {
    text: string;
    segments: Array<{ text: string; start_sec: number; end_sec: number }>;
  };
  summary?: string;
  topics?: Array<{
    index: number;
    title: string;
    summary: string;
    detail?: string;
    start_sec: number;
    end_sec: number;
    transcript: string;
  }>;
  chunks?: Array<{ index: number; start_sec: number; end_sec: number; text: string }>;
};

// The API requires transcript.text to be non-empty. For jobs with no chunks, fall back to
// the summary or a placeholder so the sync request passes validation.
const FALLBACK_TRANSCRIPT = "(no transcript)";

const audioFilenameFromKey = (audioKey: string) => audioKey.split("/").pop() ?? "audio";

export const buildSyncPayload = (input: {
  job: Job;
  topics: Topic[];
  chunks: Chunk[];
}): SyncPayload => {
  const { job, topics, chunks } = input;

  const chunkTranscripts = chunks.map((c) => c.transcript ?? "").filter((t) => t.length > 0);
  const transcriptText =
    chunkTranscripts.length > 0 ? chunkTranscripts.join("\n") : job.summary || FALLBACK_TRANSCRIPT;

  return {
    audio_filename: audioFilenameFromKey(job.audioKey),
    transcript: {
      text: transcriptText,
      segments: chunks.map((c) => ({
        text: c.transcript ?? "",
        start_sec: c.startSec,
        end_sec: c.endSec,
      })),
    },
    ...(job.summary ? { summary: job.summary } : {}),
    topics:
      topics.length > 0
        ? topics.map((t) => ({
            index: t.topicIndex,
            title: t.title,
            summary: t.summary ?? "",
            ...(t.detail ? { detail: t.detail } : {}),
            start_sec: t.startSec ?? 0,
            end_sec: t.endSec ?? 0,
            transcript: t.transcript,
          }))
        : undefined,
    chunks:
      chunks.length > 0
        ? chunks.map((c) => ({
            index: c.chunkIndex,
            start_sec: c.startSec,
            end_sec: c.endSec,
            text: c.transcript ?? "",
          }))
        : undefined,
  };
};
