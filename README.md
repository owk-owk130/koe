# koe

capture voice and shape it into structured thoughts.

音声をテキストに文字起こしし、トピックごとに分割する API + MCP サーバー。

利用者向けのセットアップ・使い方ガイド → [USECASES.md](./USECASES.md)

## Architecture

```
Desktop App (Electron + React)
    ├── ローカル処理パス
    │     main process ── Go sidecar (cmd/sidecar)
    │                       ├── ffmpeg 音声分割
    │                       ├── Whisper 文字起こし
    │                       └── Gemini トピック分割
    └── サーバー同期パス（要認証、optional）
          ▼
Workers (Hono/TS) ── API / 認証 / 同期
    │                   ├── R2 (テキスト結果)
    │                   └── D1 (ジョブ/トピックのメタ情報)
    ▼ DurableObject (KoeProcessor)
Workers Containers (Go HTTP :8080) ── Web版用
    ├── ffmpeg 音声分割
    ├── Whisper (Workers AI)
    └── Gemini (トピック分割)
```

## Project Structure

```
packages/
├── api/       # Cloudflare Workers + Hono (TypeScript)
├── worker/    # Go - 音声処理 (server / sidecar / cli / mcp)
├── shared/    # 共有ユーティリティ (format / auth / API client)
└── desktop/   # Electron デスクトップアプリ
```

## Prerequisites

- [Go](https://go.dev/) 1.26+
- [Node.js](https://nodejs.org/) 24+
- [pnpm](https://pnpm.io/) 10+
- [ffmpeg](https://ffmpeg.org/) (音声分割に使用)
- [Cloudflare account](https://dash.cloudflare.com/) (デプロイ時)

## Setup

```bash
# clone
git clone https://github.com/owk-owk130/koe.git
cd koe

# install dependencies
pnpm install

# build Go worker
cd packages/worker
go build ./...
```

## Development

### API (Workers + Hono)

```bash
pnpm dev:api
```

### Desktop App (Electron)

```bash
pnpm dev:desktop
```

### Go CLI

```bash
cd packages/worker
go run ./cmd/cli <audio-file.mp3>
```

### MCP Server

koe は 2 種類の MCP サーバーを提供する。

#### Hono (Cloudflare Workers) 版 — リモート MCP

認証済みユーザーが自分の音声アーカイブ（ジョブ／トピック）を Claude Desktop / モバイルアプリから
検索・参照するためのリモート MCP。Workers API に `/mcp` として同居する（Streamable HTTP transport）。

提供ツール:

| Tool            | 引数                | 用途                                |
| --------------- | ------------------- | ----------------------------------- |
| `list_jobs`     | `limit?`, `offset?` | 自分のジョブ一覧                    |
| `get_job`       | `job_id`            | ジョブ詳細                          |
| `get_topics`    | `job_id`            | ジョブに紐づくトピック一覧          |
| `search_topics` | `query`, `limit?`   | タイトル/サマリ部分一致（自分のみ） |

Claude Desktop 設定例:

```json
{
  "mcpServers": {
    "koe": {
      "url": "https://<your-workers-domain>/mcp",
      "headers": { "Authorization": "Bearer <JWT>" }
    }
  }
}
```

JWT は `/auth/device` → `/auth/token` の Device Flow で発行する。

#### Go (stdio) 版 — ローカル MCP

手元の音声ファイルをそのまま文字起こし／トピック分割する用途。認証不要。

```bash
cd packages/worker
go run ./cmd/mcp
```

MCP 設定例:

```json
{
  "mcpServers": {
    "koe-local": {
      "command": "go",
      "args": ["run", "./cmd/mcp"],
      "cwd": "/path/to/koe/packages/worker",
      "env": {
        "WHISPER_BASE_URL": "https://api.cloudflare.com/client/v4/accounts/{your-account-id}/ai",
        "WHISPER_API_KEY": "your-cloudflare-api-token",
        "WHISPER_MODEL": "@cf/openai/whisper-large-v3-turbo",
        "GEMINI_API_KEY": "your-gemini-api-key"
      }
    }
  }
}
```

### Deploy

```bash
# Cloudflare Workers API
pnpm deploy:api
```

## Environment Variables

### Go Worker (CLI / MCP)

| Variable           | Required           | Description                                                                    |
| ------------------ | ------------------ | ------------------------------------------------------------------------------ |
| `WHISPER_BASE_URL` | Yes                | Cloudflare Workers AI: `https://api.cloudflare.com/client/v4/accounts/{id}/ai` |
| `WHISPER_API_KEY`  | Yes                | Cloudflare API token (Workers AI 権限)                                         |
| `WHISPER_MODEL`    | Yes                | モデル名 (推奨: `@cf/openai/whisper-large-v3-turbo`)                           |
| `GEMINI_API_KEY`   | CLI: Yes / MCP: No | Gemini API key (トピック分割、MCP では任意)                                    |
| `GEMINI_MODEL`     | No                 | Gemini model name (default: `gemini-2.0-flash-lite`)                           |

### Workers API

| Variable               | Type   | Description                                                                    |
| ---------------------- | ------ | ------------------------------------------------------------------------------ |
| `GOOGLE_CLIENT_ID`     | vars   | Google OAuth client ID                                                         |
| `GOOGLE_CLIENT_SECRET` | secret | Google OAuth client secret                                                     |
| `JWT_SECRET`           | secret | JWT signing key (HS256)                                                        |
| `WHISPER_BASE_URL`     | vars   | Cloudflare Workers AI: `https://api.cloudflare.com/client/v4/accounts/{id}/ai` |
| `WHISPER_API_KEY`      | secret | Cloudflare API token (Workers AI 権限)                                         |
| `WHISPER_MODEL`        | vars   | モデル名 (推奨: `@cf/openai/whisper-large-v3-turbo`)                           |
| `GEMINI_API_KEY`       | secret | Gemini API key                                                                 |
| `GEMINI_MODEL`         | vars   | Gemini model name (default: `gemini-2.0-flash-lite`)                           |

Workers secrets は `wrangler secret put` で設定。ローカル開発は `packages/api/.dev.vars` を使用。

## License

MIT
