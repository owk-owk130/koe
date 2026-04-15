import { useCallback, useEffect, useRef, useState } from "react";
import { createApiClient, type Job } from "@koe/shared";
import { useAuth } from "./useAuth";

const API_URL = "http://localhost:8787";
const POLL_INTERVAL_MS = 5000;
const api = createApiClient(API_URL);

export function useJobs() {
  const { token } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await api.listJobs(token);
      setJobs(res.jobs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch jobs");
    } finally {
      setLoading(false);
    }
  }, [token]);

  // 外部システム（API）との同期: 初回取得 + アクティブジョブ時のポーリング
  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    async function fetch() {
      try {
        const res = await api.listJobs(token);
        if (!cancelled) {
          setJobs(res.jobs);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to fetch jobs");
        }
      }
    }

    fetch();

    const timerId = setInterval(() => {
      const hasActive = jobsRef.current.some(
        (j) => j.status === "pending" || j.status === "processing",
      );
      if (hasActive) fetch();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timerId);
    };
  }, [token]);

  return { jobs, loading, error, refresh };
}
