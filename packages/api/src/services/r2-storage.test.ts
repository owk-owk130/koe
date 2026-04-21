import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { deleteByPrefix, downloadAudio, downloadJSON, uploadAudio, uploadJSON } from "./r2-storage";

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

  describe("deleteByPrefix", () => {
    it("removes every object whose key starts with the given prefix", async () => {
      await uploadAudio(env.BUCKET, "u-del/audio/j1/original.mp3", new Uint8Array([1]).buffer);
      await uploadAudio(env.BUCKET, "u-del/audio/j1/chunks/0.mp3", new Uint8Array([2]).buffer);
      await uploadJSON(env.BUCKET, "u-del/results/j1/transcript.json", { text: "x" });
      await uploadAudio(env.BUCKET, "u-del/audio/j2/original.mp3", new Uint8Array([3]).buffer);

      await deleteByPrefix(env.BUCKET, "u-del/audio/j1/");
      await deleteByPrefix(env.BUCKET, "u-del/results/j1/");

      expect(await downloadAudio(env.BUCKET, "u-del/audio/j1/original.mp3")).toBeNull();
      expect(await downloadAudio(env.BUCKET, "u-del/audio/j1/chunks/0.mp3")).toBeNull();
      expect(await downloadJSON(env.BUCKET, "u-del/results/j1/transcript.json")).toBeNull();
      // unrelated job untouched
      expect(await downloadAudio(env.BUCKET, "u-del/audio/j2/original.mp3")).not.toBeNull();
    });

    it("is a no-op when the prefix has no objects", async () => {
      await expect(deleteByPrefix(env.BUCKET, "nothing-here/")).resolves.toBeUndefined();
    });
  });
});
