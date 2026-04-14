import { useCallback, useEffect, useRef, useState } from "react";
import { createApiClient, type JobDetailResponse, type Topic } from "@koe/shared";
import { useAuth } from "./useAuth";

const API_URL = "http://localhost:8787";

export function useJobDetail(jobId: string | null) {
  const { token } = useAuth();
  const [job, setJob] = useState<JobDetailResponse | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const api = createApiClient(API_URL);

  const fetchDetail = useCallback(async () => {
    if (!token || !jobId) return;
    try {
      const detail = await api.getJob(token, jobId);
      setJob(detail);
      setError(null);

      if (detail.status === "completed") {
        const res = await api.getTopics(token, jobId);
        setTopics(res.topics);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch job");
    }
  }, [token, jobId, api]);

  useEffect(() => {
    if (!jobId) return;
    setLoading(true);
    fetchDetail().finally(() => setLoading(false));

    timerRef.current = setInterval(() => {
      if (job && (job.status === "pending" || job.status === "processing")) {
        fetchDetail();
      }
    }, 3000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [jobId, fetchDetail, job]);

  return { job, topics, loading, error };
}
