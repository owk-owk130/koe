// API URL は build 時に `VITE_KOE_API_URL` で差し替える。未指定ならローカル dev 用 Wrangler。
// renderer にだけ配る想定なので electron-vite の RENDERER_VITE_ 変換を経由して import.meta.env に載る。
export const API_URL =
  (import.meta.env.VITE_KOE_API_URL as string | undefined) ?? "http://localhost:8787";
