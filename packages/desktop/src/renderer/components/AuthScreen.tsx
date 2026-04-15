import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Mic } from "lucide-react";
import { createClient } from "@koe/shared";
import { useAuth } from "../hooks/useAuth";

const API_URL = "http://localhost:8787";
const client = createClient(API_URL);

type FlowState = "idle" | "polling" | "success" | "error";
type DeviceCode = Awaited<ReturnType<typeof client.auth.device.$get>> extends { json(): Promise<infer T> } ? T : never;

export function AuthScreen() {
  const { login } = useAuth();
  const [flowState, setFlowState] = useState<FlowState>("idle");
  const [deviceCode, setDeviceCode] = useState<DeviceCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startFlow = useCallback(async () => {
    setError(null);
    setFlowState("idle");
    try {
      const codeRes = await client.auth.device.$get();
      const code = await codeRes.json();
      setDeviceCode(code);
      setFlowState("polling");

      timerRef.current = setInterval(
        async () => {
          try {
            const tokenRes = await client.auth.token.$post({
              json: { device_code: code.device_code },
            });
            if (tokenRes.status === 428) return;
            const result = await tokenRes.json();
            if ("token" in result) {
              if (timerRef.current) clearInterval(timerRef.current);
              setFlowState("success");
              await login(result.token);
            }
          } catch (e) {
            if (timerRef.current) clearInterval(timerRef.current);
            setFlowState("error");
            setError(e instanceof Error ? e.message : "Authentication failed");
          }
        },
        (code.interval || 5) * 1000,
      );
    } catch (e) {
      setFlowState("error");
      setError(e instanceof Error ? e.message : "Failed to start authentication");
    }
  }, [login]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const copyCode = useCallback(() => {
    if (deviceCode) {
      navigator.clipboard.writeText(deviceCode.user_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [deviceCode]);

  const openVerification = useCallback(() => {
    if (deviceCode) {
      window.electronAPI.openExternal(deviceCode.verification_url);
    }
  }, [deviceCode]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-8">
      <div className="w-full max-w-[360px] rounded-card bg-white p-8 shadow-card">
        <div className="flex flex-col items-center gap-5">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-light">
            <Mic size={22} className="text-brand" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">koe</h1>
          <p className="text-[13px] text-text-secondary">
            音声を文字起こしし、トピックに分割します
          </p>

          <div className="h-px w-full bg-surface" />

          {flowState === "idle" && (
            <button
              onClick={startFlow}
              className="w-full rounded-button bg-text-primary py-2.5 text-[13px] font-medium text-white hover:opacity-90"
            >
              Google でログイン
            </button>
          )}

          {flowState === "polling" && deviceCode && (
            <div className="flex w-full flex-col items-center gap-4">
              <p className="text-xs text-text-secondary">ブラウザでコードを入力してください</p>
              <button
                onClick={copyCode}
                className="font-mono text-[28px] font-medium tracking-wider text-text-primary hover:opacity-70"
              >
                {deviceCode.user_code}
              </button>
              <p className="text-[11px] text-text-secondary">
                {copied ? "コピーしました" : "クリックでコピー"}
              </p>
              <button
                onClick={openVerification}
                className="flex w-full items-center justify-center gap-2 rounded-button bg-text-primary py-2.5 text-[13px] font-medium text-white hover:opacity-90"
              >
                <ExternalLink size={14} />
                ブラウザで認証ページを開く
              </button>
              <div className="flex items-center gap-2 text-xs text-text-secondary">
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                認証待ち...
              </div>
            </div>
          )}

          {flowState === "success" && (
            <p className="text-sm font-medium text-success">ログイン成功！</p>
          )}

          {flowState === "error" && (
            <div className="flex w-full flex-col items-center gap-3">
              <p className="text-xs text-error">{error}</p>
              <button
                onClick={startFlow}
                className="w-full rounded-button bg-text-primary py-2.5 text-[13px] font-medium text-white hover:opacity-90"
              >
                やり直す
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
