# koe

音声をテキストに文字起こしし、トピックごとに分割するAPI + MCPサーバー。

## Architecture

### 全体構成（フル Cloudflare）

```
CLI / MCP Client
    │
    ▼
Workers (Hono/TS) ── API / 認証
    │                   ├── R2 (音声ファイル + テキスト結果)
    │                   └── D1 (ジョブ/チャンク/トピックのメタ情報)
    ▼ getContainer()
Workers Containers (Go)
    ├── ffmpeg 音声分割
    ├── Whisper (Workers AI / OpenAI互換)
    └── LLM トピック分割 (Gemini Flash-Lite)
```

### パッケージ構成（モノレポ）

```
packages/
├── api/       # Workers + Hono (TS) - API / 認証
├── worker/    # Go - 音声処理 (server / cli / mcp)
└── web/       # Astro + React - ビューワー（後回し）
```

### 技術スタック

| レイヤー | 技術 |
|---------|------|
| API | Cloudflare Workers + Hono (TypeScript) |
| 音声処理 | Go (Workers Containers / ローカル CLI / MCP) |
| 文字起こし | Workers AI Whisper (@cf/openai/whisper-large-v3-turbo)、OpenAI互換で差し替え可能 |
| トピック分割 | Gemini Flash-Lite（デフォルト）、interface で差し替え可能 |
| DB | Cloudflare D1 |
| Storage | Cloudflare R2 |
| 認証 | Google OAuth (Device Flow) → JWT |
| フロント | Astro + React (CF Pages) ※後回し |

### API 設計

```
# パブリック（ステートレス、レート制限あり）
POST /api/v1/transcribe        # 音声→テキスト、保存しない（optionalAuth）

# 認証あり（ステートフル）
POST /api/v1/jobs              # ジョブ作成（文字起こし+トピック分割+保存）
GET  /api/v1/jobs              # ジョブ一覧（自分のだけ）
GET  /api/v1/jobs/:id          # ジョブ詳細
GET  /api/v1/jobs/:id/topics   # トピック一覧

# 認証
GET  /auth/device              # Device Flow 開始
POST /auth/token               # トークン交換
```

- `/transcribe` は `optionalAuth`：トークンなしでも使えるが、将来 `requireAuth` に差し替え可能
- 認証ありエンドポイントはユーザーごとにデータ分離

### R2 キー設計

```
{userId}/audio/{jobId}/original.mp3
{userId}/audio/{jobId}/chunks/{index}.mp3
{userId}/results/{jobId}/transcript.json
{userId}/results/{jobId}/topics.json
```

### ジョブ状態遷移

```
pending → splitting → transcribing → analyzing → completed
   ↓         ↓            ↓             ↓
 failed    failed       failed        failed
```

### 設計方針

- Whisper / LLM クライアントは interface で抽象化し、baseURL 差し替えで切り替え可能にする
- Go のコアロジックは cmd/server, cmd/cli, cmd/mcp で共有
- D1 にはメタ情報のみ、巨大テキストは R2 に JSON で保存
- 長時間音声はチャンク分割（静音検出 + 時間上限）で対応
- 大容量ファイルは R2 Multipart Upload で対応
- ジョブは冪等性を担保（チャンクID + 状態管理）
- 進捗通知はポーリング + ステータスAPI

## Coding Rules

- パッケージマネージャーは pnpm を使用
- コード修正後は test / lint / format を実行
- YAGNI 原則に従い余計な機能は実装しない
