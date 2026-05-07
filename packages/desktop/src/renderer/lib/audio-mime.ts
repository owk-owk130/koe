// Maps audio filename extensions to MIME types. Used at the file-picker
// boundary where we read raw bytes via Electron IPC and need to wrap them in
// a Blob with the correct content type so the server stores the original
// recording with a faithful extension. Mirrors the server-side
// extensionFor() / mimeToExt() pairing in packages/api and packages/desktop's
// useJobs hook.
const EXTENSION_TO_MIME: Record<string, string> = {
  webm: "audio/webm",
  mp3: "audio/mpeg",
  mp4: "audio/mp4",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  flac: "audio/flac",
};

export function mimeFromFilename(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : null;
  return (ext && EXTENSION_TO_MIME[ext]) ?? "application/octet-stream";
}
