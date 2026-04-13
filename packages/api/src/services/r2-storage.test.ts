import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { downloadAudio, downloadJSON, uploadAudio, uploadJSON } from "./r2-storage";

describe("r2-storage", () => {
  it("uploads and downloads audio", async () => {
    const data = new Uint8Array([0x49, 0x44, 0x33]).buffer;
    await uploadAudio(env.BUCKET, "test/audio.mp3", data);

    const result = await downloadAudio(env.BUCKET, "test/audio.mp3");
    expect(result).not.toBeNull();

    const bytes = new Uint8Array(await result!.arrayBuffer());
    expect(bytes).toEqual(new Uint8Array([0x49, 0x44, 0x33]));
  });

  it("returns null for non-existent audio", async () => {
    const result = await downloadAudio(env.BUCKET, "nonexistent");
    expect(result).toBeNull();
  });

  it("uploads and downloads JSON", async () => {
    const data = { text: "hello", segments: [{ start: 0, end: 10 }] };
    await uploadJSON(env.BUCKET, "test/result.json", data);

    const result = await downloadJSON<typeof data>(env.BUCKET, "test/result.json");
    expect(result).toEqual(data);
  });

  it("returns null for non-existent JSON", async () => {
    const result = await downloadJSON(env.BUCKET, "nonexistent.json");
    expect(result).toBeNull();
  });
});
