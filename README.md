# koe

capture voice and shape it into structured thoughts.

音声をテキストに文字起こしし、トピックごとに分割する API + MCP サーバー。

## Architecture

```
CLI / MCP Client
    │
    ▼
Workers (Hono/TS) ── API / 認証
    │                   ├── R2 (音声 + 結果)
    │                   └── D1 (メタ情報)
    ▼ getContainer()
Workers Containers (Go)
    ├── ffmpeg 音声分割
    ├── Whisper (Workers AI)
    └── Gemini (トピック分割)
```

## Project Structure

```
packages/
├── api/       # Cloudflare Workers + Hono (TypeScript)
├── worker/    # Go - 音声処理 (server / cli / mcp)
└── web/       # Astro + React - ビューワー (TBD)
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

### Go CLI

```bash
cd packages/worker
go run ./cmd/cli <audio-file.mp3>
```

### Deploy

```bash
# Cloudflare Workers API
pnpm deploy:api
```

## Environment Variables

| Variable           | Description                                |
| ------------------ | ------------------------------------------ |
| `GEMINI_API_KEY`   | Gemini API key (トピック分割)              |
| `WHISPER_BASE_URL` | Whisper API endpoint (default: Workers AI) |
| `WHISPER_API_KEY`  | Whisper API key                            |

## License

MIT
