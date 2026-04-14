import { useCallback, useEffect, useRef, useState } from "react";
import { createApiClient, type Job } from "@koe/shared";
import { useAuth } from "./useAuth";

const API_URL = "http://localhost:8787";

export function useJobs() {
  const { token } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const api = createApiClient(API_URL);

  const fetchJobs = useCallback(async () => {
    if (!token) return;
    try {
      const res = await api.listJobs(token);
      setJobs(res.jobs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch jobs");
    }
  }, [token, api]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await fetchJobs();
    setLoading(false);
  }, [fetchJobs]);

  // Poll every 3s if any job is pending/processing
  useEffect(() => {
    if (!token) return;
    refresh();

    timerRef.current = setInterval(() => {
      const hasActive = jobs.some((j) => j.status === "pending" || j.status === "processing");
      if (hasActive) fetchJobs();
    }, 3000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [token, refresh, fetchJobs, jobs]);

  return { jobs, loading, error, refresh };
}
