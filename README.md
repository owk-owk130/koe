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

### MCP Server

Claude Desktop / Claude Code から利用する場合:

```bash
cd packages/worker
go run ./cmd/mcp
```

MCP 設定例:

```json
{
  "mcpServers": {
    "koe": {
      "command": "go",
      "args": ["run", "./cmd/mcp"],
      "cwd": "/path/to/koe/packages/worker",
      "env": {
        "WHISPER_API_KEY": "your-key",
        "GEMINI_API_KEY": "your-key"
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

| Variable           | Description                                              |
| ------------------ | -------------------------------------------------------- |
| `WHISPER_API_KEY`  | Whisper API key                                          |
| `WHISPER_BASE_URL` | Whisper API endpoint (default: `https://api.openai.com`) |
| `WHISPER_MODEL`    | Whisper model name (default: `whisper-1`)                |
| `GEMINI_API_KEY`   | Gemini API key (トピック分割、MCP では任意)              |
| `GEMINI_MODEL`     | Gemini model name (default: `gemini-2.0-flash-lite`)     |

### Workers API

| Variable               | Type   | Description                |
| ---------------------- | ------ | -------------------------- |
| `GOOGLE_CLIENT_ID`     | vars   | Google OAuth client ID     |
| `GOOGLE_CLIENT_SECRET` | secret | Google OAuth client secret |
| `JWT_SECRET`           | secret | JWT signing key (HS256)    |

Workers secrets は `wrangler secret put` で設定。ローカル開発は `packages/api/.dev.vars` を使用。

## License

MIT
