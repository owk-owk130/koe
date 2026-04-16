# koe

音声をテキストに文字起こしし、トピックごとに分割するAPI + MCPサーバー。

## Architecture

### 全体構成（ハイブリッド）

```
Desktop App (Electron + React)
    ├── ローカル処理パス（認証不要）
    │     main process ── Go sidecar (cmd/sidecar)
    │                       ├── ffmpeg 音声分割
    │                       ├── Whisper (OpenAI互換)
    │                       └── Gemini トピック分割
    └── サーバー同期パス（認証必要、optional）
          ▼
Workers (Hono/TS) ── API / 認証 / 同期
    │                   ├── R2 (テキスト結果)
    │                   └── D1 (ジョブ/トピックのメタ情報)
    ▼ DurableObject (KoeProcessor) ── alarm パターンで非同期ジョブ処理（Web版用）
Workers Containers (Go HTTP :8080) ── Web版用
    ├── ffmpeg 音声分割
    ├── Whisper (Workers AI / OpenAI互換)
    └── LLM トピック分割 (Gemini Flash-Lite)
```

### パッケージ構成（モノレポ）

```
packages/
├── api/       # Workers + Hono (TS) - API / 認証
├── worker/    # Go - 音声処理 (server / sidecar / cli / mcp)
├── shared/    # 共有ユーティリティ (format / auth / API client)
└── desktop/   # Electron デスクトップアプリ
```

### 技術スタック

| レイヤー     | 技術                                                                             |
| ------------ | -------------------------------------------------------------------------------- |
| API          | Cloudflare Workers + Hono (TypeScript)                                           |
| 音声処理     | Go (ローカル sidecar / Workers Containers / CLI / MCP)                            |
| 文字起こし   | Workers AI Whisper (@cf/openai/whisper-large-v3-turbo)、OpenAI互換で差し替え可能 |
| トピック分割 | Gemini Flash-Lite（デフォルト）、interface で差し替え可能                        |
| DB           | Cloudflare D1                                                                    |
| Storage      | Cloudflare R2                                                                    |
| 認証         | Google OAuth (Device Flow) → JWT                                                 |
| フロント     | Electron + React (デスクトップアプリ)                                            |

### API 設計

```
# パブリック（ステートレス、レート制限あり）
POST /api/v1/transcribe        # 音声→テキスト、保存しない（optionalAuth）

# 認証あり（ステートフル）
POST /api/v1/sync              # ローカル処理結果をサーバーに同期（Desktop→Cloud）
POST /api/v1/jobs              # ジョブ作成（文字起こし+トピック分割+保存）→ DO alarm で非同期処理
GET  /api/v1/jobs              # ジョブ一覧（自分のだけ）
GET  /api/v1/jobs/:id          # ジョブ詳細
GET  /api/v1/jobs/:id/topics   # トピック一覧

# R2 Multipart Upload（大容量音声）
POST /api/v1/uploads                        # アップロード開始
PUT  /api/v1/uploads/:uploadId/parts/:num   # パーツアップロード
POST /api/v1/uploads/:uploadId/complete      # 完了
DELETE /api/v1/uploads/:uploadId             # 中止

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
pending → processing → completed
   ↓          ↓
 failed     failed (リトライ max 3回、指数バックオフ)
```

### 設計方針

- Whisper / LLM クライアントは interface で抽象化し、baseURL 差し替えで切り替え可能にする
- Go のコアロジックは cmd/server, cmd/sidecar, cmd/cli, cmd/mcp で共有
- D1 にはメタ情報のみ、巨大テキストは R2 に JSON で保存
- 長時間音声はチャンク分割（静音検出 + 時間上限）で対応
- 大容量ファイルは R2 Multipart Upload で対応
- ジョブは冪等性を担保（チャンクID + 状態管理）
- 進捗通知はポーリング + ステータスAPI

## Coding Rules

- パッケージマネージャーは pnpm を使用
- コード修正後は test / lint / format を実行
- テスト駆動開発（TDD）で進める（Red → Green → Refactor）
- YAGNI 原則に従い余計な機能は実装しない
