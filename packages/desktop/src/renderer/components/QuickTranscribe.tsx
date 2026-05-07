import { useEffect, useState } from "react";
import { JobResultPanel } from "./JobResultPanel";
import { RecordingPanel } from "./RecordingPanel";
import { useCreateJob } from "~/renderer/hooks/useJobs";

export function QuickTranscribe() {
  const createJob = useCreateJob();
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);

  // Reset current job if creation is retried so the panel doesn't briefly
  // render the previous job while the next one is being chunked / uploaded.
  useEffect(() => {
    if (createJob.isPending) setCurrentJobId(null);
  }, [createJob.isPending]);

  const transcribeBlob = async (blob: Blob) => {
    const result = await createJob.mutateAsync(blob);
    setCurrentJobId(result.id);
  };

  const transcribeFile = async () => {
    const fileInfo = await window.electronAPI.selectAudioFile();
    if (!fileInfo) return;
    const buffer = await window.electronAPI.readFile(fileInfo.path);
    const blob = new Blob([buffer], { type: "audio/mpeg" });
    const result = await createJob.mutateAsync(blob);
    setCurrentJobId(result.id);
  };

  const uploading = createJob.isPending;
  const uploadError = createJob.error?.message ?? null;

  return (
    <div className="flex flex-1 flex-col gap-5 p-6">
      <h1 className="text-xl font-semibold text-text-primary">クイック文字起こし</h1>

      <div className="shrink-0 rounded-[12px] border border-[rgba(0,0,0,0.03)] bg-white px-5 py-4">
        <RecordingPanel
          onRecordingComplete={transcribeBlob}
          onFileSelect={transcribeFile}
          fileSelectDisabled={uploading}
          transcribing={uploading || currentJobId !== null}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        {uploading && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-[12px] border border-[rgba(0,0,0,0.03)] bg-white">
            <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-brand border-t-transparent" />
            <p className="text-[13px] font-medium text-text-primary">音声を準備中...</p>
          </div>
        )}

        {uploadError && <p className="text-xs text-error">{uploadError}</p>}

        {currentJobId && (
          <JobResultPanel jobId={currentJobId} onDeleted={() => setCurrentJobId(null)} />
        )}

        {!uploading && !uploadError && !currentJobId && (
          <div className="flex flex-1 items-center justify-center rounded-[12px] border border-[rgba(0,0,0,0.03)] bg-white">
            <p className="text-[13px] text-text-secondary">
              録音またはファイルを選択して文字起こしを開始
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
