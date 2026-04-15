import { useEffect, useRef, useState } from "react";
import { createApiClient, type JobDetailResponse, type Topic } from "@koe/shared";
import { useAuth } from "./useAuth";

const API_URL = "http://localhost:8787";
const POLL_INTERVAL_MS = 3000;
const api = createApiClient(API_URL);

export function useJobDetail(jobId: string | null) {
  const { token } = useAuth();
  const [job, setJob] = useState<JobDetailResponse | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jobRef = useRef(job);
  jobRef.current = job;

  // 外部システム（API）との同期: ジョブ詳細の取得 + 処理中ポーリング
  useEffect(() => {
    if (!token || !jobId) return;

    let cancelled = false;
    setJob(null);
    setTopics([]);
    setLoading(true);

    async function fetch() {
      try {
        const detail = await api.getJob(token, jobId!);
        if (cancelled) return;
        setJob(detail);
        setError(null);

        if (detail.status === "completed") {
          const res = await api.getTopics(token, jobId!);
          if (!cancelled) setTopics(res.topics);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to fetch job");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetch();

    const timerId = setInterval(() => {
      const current = jobRef.current;
      if (current && (current.status === "pending" || current.status === "processing")) {
        fetch();
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timerId);
    };
  }, [token, jobId]);

  return { job, topics, loading, error };
}
