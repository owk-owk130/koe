import { safeStorage } from "electron";
import Store from "electron-store";

export interface AppSettings {
  whisperBaseUrl: string;
  whisperModel: string;
  geminiModel: string;
}

export interface ApiKeys {
  whisperApiKey: string | null;
  geminiApiKey: string | null;
}

export interface SidecarConfig {
  whisper_base_url: string;
  whisper_api_key: string;
  whisper_model: string;
  gemini_api_key?: string;
  gemini_model?: string;
  ffmpeg_path?: string;
  ffprobe_path?: string;
}

interface StoreSchema {
  settings?: AppSettings;
  encryptedWhisperApiKey?: string;
  encryptedGeminiApiKey?: string;
}

const store = new Store<StoreSchema>({ name: "koe-settings" });

const DEFAULT_SETTINGS: AppSettings = {
  whisperBaseUrl: "https://api.openai.com",
  whisperModel: "whisper-1",
  geminiModel: "gemini-2.0-flash-lite",
};

function encryptKey(key: string): string {
  return safeStorage.encryptString(key).toString("base64");
}

function decryptKey(encrypted: string): string {
  return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
}

export function getSettings(): AppSettings {
  return store.get("settings") ?? { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: AppSettings): void {
  store.set("settings", settings);
}

export function getApiKeys(): ApiKeys {
  const whisper = store.get("encryptedWhisperApiKey");
  const gemini = store.get("encryptedGeminiApiKey");
  return {
    whisperApiKey: whisper ? decryptKey(whisper) : null,
    geminiApiKey: gemini ? decryptKey(gemini) : null,
  };
}

export function saveApiKeys(keys: { whisperApiKey: string; geminiApiKey?: string }): void {
  store.set("encryptedWhisperApiKey", encryptKey(keys.whisperApiKey));
  if (keys.geminiApiKey) {
    store.set("encryptedGeminiApiKey", encryptKey(keys.geminiApiKey));
  } else {
    store.delete("encryptedGeminiApiKey");
  }
}

export function getSidecarConfig(ffmpegPath?: string, ffprobePath?: string): SidecarConfig | null {
  const apiKeys = getApiKeys();
  if (!apiKeys.whisperApiKey) return null;

  const settings = getSettings();
  return {
    whisper_base_url: settings.whisperBaseUrl,
    whisper_api_key: apiKeys.whisperApiKey,
    whisper_model: settings.whisperModel,
    gemini_api_key: apiKeys.geminiApiKey ?? undefined,
    gemini_model: settings.geminiModel,
    ffmpeg_path: ffmpegPath,
    ffprobe_path: ffprobePath,
  };
}

export function isConfigured(): boolean {
  return store.get("encryptedWhisperApiKey") != null;
}
