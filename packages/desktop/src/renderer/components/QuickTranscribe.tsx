import { useCallback, useState } from "react";
import { createApiClient, formatDuration, type TranscribeResponse } from "@koe/shared";
import { RecordingPanel } from "./RecordingPanel";
import { Upload } from "lucide-react";

const API_URL = "http://localhost:8787";

export function QuickTranscribe() {
  const [result, setResult] = useState<TranscribeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const api = createApiClient(API_URL);

  const transcribeBlob = useCallback(
    async (blob: Blob) => {
      setLoading(true);
      setError(null);
      try {
        const file = new File([blob], `quick-${Date.now()}.webm`, { type: "audio/webm" });
        const res = await api.transcribe(file);
        setResult(res);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Transcription failed");
      } finally {
        setLoading(false);
      }
    },
    [api],
  );

  const transcribeFile = useCallback(async () => {
    const fileInfo = await window.electronAPI.selectAudioFile();
    if (!fileInfo) return;

    setLoading(true);
    setError(null);
    try {
      const buffer = await window.electronAPI.readFile(fileInfo.path);
      const file = new File([buffer], fileInfo.name, { type: "audio/mpeg" });
      const res = await api.transcribe(file);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transcription failed");
    } finally {
      setLoading(false);
    }
  }, [api]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-3 font-semibold">録音して文字起こし</h2>
        <RecordingPanel onRecordingComplete={transcribeBlob} />
      </div>

      <div>
        <button
          onClick={transcribeFile}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          <Upload size={16} />
          ファイルから文字起こし
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          文字起こし中...
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && (
        <div className="space-y-4">
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <h3 className="font-semibold">トランスクリプト</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm">{result.transcript.text}</p>
          </div>

          {result.topics.length > 0 && (
            <div>
              <h3 className="mb-2 font-semibold">トピック</h3>
              <div className="space-y-3">
                {result.topics.map((topic, i) => (
                  <div key={i} className="rounded-lg border bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between">
                      <h4 className="font-medium">{topic.title}</h4>
                      <span className="text-xs text-gray-500">
                        {formatDuration(topic.start_sec)} - {formatDuration(topic.end_sec)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-gray-600">{topic.summary}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
