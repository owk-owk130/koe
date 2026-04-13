import type { JobPayload, ProcessResult } from "../container";

export const enqueueJob = async (
  processor: DurableObjectNamespace,
  job: JobPayload,
): Promise<void> => {
  const id = processor.idFromName(job.jobId);
  const stub = processor.get(id);
  const response = await stub.fetch("http://do/enqueue", {
    method: "POST",
    body: JSON.stringify(job),
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    throw new Error(`enqueue failed: ${response.status}`);
  }
};

export const processAudioDirect = async (
  processor: DurableObjectNamespace,
  audioStream: ReadableStream,
  contentType: string,
): Promise<ProcessResult> => {
  const id = processor.idFromName("direct");
  const stub = processor.get(id);
  const response = await stub.fetch("http://do/process", {
    method: "POST",
    body: audioStream,
    headers: { "Content-Type": contentType },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`process failed (${response.status}): ${text}`);
  }
  return response.json<ProcessResult>();
};
