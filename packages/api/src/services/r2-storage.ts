export const uploadAudio = async (
  bucket: R2Bucket,
  key: string,
  body: ReadableStream | ArrayBuffer,
): Promise<void> => {
  await bucket.put(key, body);
};

export const downloadAudio = async (
  bucket: R2Bucket,
  key: string,
): Promise<R2ObjectBody | null> => {
  return bucket.get(key);
};

export const uploadJSON = async (bucket: R2Bucket, key: string, data: unknown): Promise<void> => {
  await bucket.put(key, JSON.stringify(data), {
    httpMetadata: { contentType: "application/json" },
  });
};

export const downloadJSON = async <T>(bucket: R2Bucket, key: string): Promise<T | null> => {
  const obj = await bucket.get(key);
  if (!obj) return null;
  return obj.json<T>();
};

// Deletes every object whose key starts with prefix. Paginates through list results
// so buckets with many chunks are cleared completely. Each page depends on the cursor
// from the previous one, so the awaits are sequential by design.
export const deleteByPrefix = async (bucket: R2Bucket, prefix: string): Promise<void> => {
  let cursor: string | undefined;
  do {
    // oxlint-disable-next-line no-await-in-loop
    const listed = await bucket.list({ prefix, cursor });
    if (listed.objects.length > 0) {
      // oxlint-disable-next-line no-await-in-loop
      await bucket.delete(listed.objects.map((o) => o.key));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
};
