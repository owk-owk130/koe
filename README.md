# koe

capture voice and shape it into structured thoughts.

音声をテキストに文字起こしし、トピックごとに分割するデスクトップアプリ + API + MCP サーバー。

利用者向けのセットアップ・使い方ガイド → [USECASES.md](./USECASES.md)

## Architecture

```
Desktop App (Electron + React)
    ├─ 録音 (MediaRecorder)
    ├─ ジョブ作成 (multipart form)
    └─ ジョブポーリング
         ▼
Workers (Hono/TS) ── API / 認証 (すべて requireAuth)
    │                   ├── R2 (音声 + 結果 JSON)
    │                   └── D1 (ジョブ/トピックのメタ情報)
    ▼ DurableObject (KoeProcessor) ── alarm 非同期
Workers Containers (Go HTTP :8080) ── 音声処理
    ├── ffmpeg 音声分割
    ├── Whisper (Workers AI)
    └── Gemini トピック分割
```

## Project Structure

```
packages/
├── api/       # Cloudflare Workers + Hono (TypeScript)
├── worker/    # Go - 音声処理 (Workers Containers)
├── shared/    # 共有ユーティリティ (format / auth / API client)
└── desktop/   # Electron デスクトップアプリ
```

## Prerequisites

- [Go](https://go.dev/) 1.26+ (Workers Containers のビルドに使用)
- [Node.js](https://nodejs.org/) 24+
- [pnpm](https://pnpm.io/) 10+
- [Cloudflare account](https://dash.cloudflare.com/) (デプロイ時)

## Setup

```bash
# clone
git clone https://github.com/owk-owk130/koe.git
cd koe

# install dependencies
pnpm install
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

### MCP Server (リモート)

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

### Deploy

```bash
# Cloudflare Workers API
pnpm deploy:api
```

## Environment Variables

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
