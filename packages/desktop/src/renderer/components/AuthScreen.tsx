import { useCallback, useEffect, useRef, useState } from "react";
import { createApiClient, type DeviceCodeResponse } from "@koe/shared";
import { useAuth } from "../hooks/useAuth";

const API_URL = "http://localhost:8787";

type FlowState = "idle" | "polling" | "success" | "error";

export function AuthScreen() {
  const { login } = useAuth();
  const [flowState, setFlowState] = useState<FlowState>("idle");
  const [deviceCode, setDeviceCode] = useState<DeviceCodeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const api = createApiClient(API_URL);

  const startFlow = useCallback(async () => {
    setError(null);
    setFlowState("idle");
    try {
      const code = await api.getDeviceCode();
      setDeviceCode(code);
      setFlowState("polling");

      timerRef.current = setInterval(
        async () => {
          try {
            const result = await api.pollToken(code.device_code);
            if (result) {
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
  }, [api, login]);

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
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-md space-y-6 text-center">
        <h1 className="text-3xl font-bold">koe</h1>
        <p className="text-gray-600">音声文字起こし + トピック分割</p>

        {flowState === "idle" && (
          <button
            onClick={startFlow}
            className="rounded-lg bg-blue-600 px-6 py-3 text-white hover:bg-blue-700"
          >
            Google でログイン
          </button>
        )}

        {flowState === "polling" && deviceCode && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">以下のコードを入力してください:</p>
            <div className="flex items-center justify-center gap-2">
              <code className="rounded bg-gray-100 px-4 py-2 text-2xl font-mono font-bold tracking-wider">
                {deviceCode.user_code}
              </code>
              <button
                onClick={copyCode}
                className="rounded border px-3 py-2 text-sm hover:bg-gray-50"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <button
              onClick={openVerification}
              className="rounded-lg bg-blue-600 px-6 py-3 text-white hover:bg-blue-700"
            >
              ブラウザで認証ページを開く
            </button>
            <p className="text-sm text-gray-500">認証が完了するまでお待ちください...</p>
            <div className="flex justify-center">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            </div>
          </div>
        )}

        {flowState === "success" && <p className="text-green-600 font-medium">ログイン成功！</p>}

        {flowState === "error" && (
          <div className="space-y-4">
            <p className="text-red-600">{error}</p>
            <button
              onClick={startFlow}
              className="rounded-lg bg-blue-600 px-6 py-3 text-white hover:bg-blue-700"
            >
              やり直す
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
