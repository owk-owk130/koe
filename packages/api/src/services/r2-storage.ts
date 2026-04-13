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
