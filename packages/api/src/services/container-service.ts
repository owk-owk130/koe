import type { JobPayload } from "~/container";

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
