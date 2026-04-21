# koe Design System

koe デスクトップアプリの UI デザインガイドライン。
ビジュアルは Airbnb のスタイルをベース、UI 構造は Apple Human Interface Guidelines に準拠。

## デザイントークン

`packages/desktop/src/renderer/styles/global.css` の `@theme` で定義。

### カラー

| トークン         | 値                                 | 用途                                   |
| ---------------- | ---------------------------------- | -------------------------------------- |
| `brand`          | `#ff385c`                          | ブランドアクセント（ロゴ・CTA・録音）  |
| `brand-light`    | `oklch(from #ff385c l c h / 0.08)` | ブランド薄背景（アイコン背景・バッジ） |
| `text-primary`   | `#222222`                          | メインテキスト・主要ボタン背景         |
| `text-secondary` | `#6a6a6a`                          | 補助テキスト・ラベル                   |
| `surface`        | `#f2f2f2`                          | テーブルヘッダー・ホバー背景           |
| `border`         | `#c1c1c1`                          | ボーダー                               |
| `success`        | `#22c55e`                          | 成功状態                               |
| `error`          | `#c13515`                          | エラー状態                             |

### シャドウ

| トークン      | 値                                                                                  |
| ------------- | ----------------------------------------------------------------------------------- |
| `shadow-card` | `0 0 0 1px rgba(0,0,0,0.02), 0 2px 6px rgba(0,0,0,0.04), 0 4px 8px rgba(0,0,0,0.1)` |

3層構造：極薄ボーダー + ソフトアンビエント + メインリフト。

### 角丸

| トークン         | 値     | 用途                   |
| ---------------- | ------ | ---------------------- |
| `rounded-button` | `8px`  | ボタン・セレクト・タブ |
| `rounded-card`   | `20px` | カード・パネル         |
| `rounded-badge`  | `14px` | ステータスバッジ       |

## タイポグラフィ

フォントはシステムフォント（Tailwind デフォルト sans-serif スタック）。

### フォントサイズ

| サイズ        | 用途                                       |
| ------------- | ------------------------------------------ |
| `text-[11px]` | バッジ・メタラベル・極小テキスト           |
| `text-xs`     | ボタンラベル・補助テキスト・タイムスタンプ |
| `text-[13px]` | 本文テキスト・リスト項目                   |
| `text-[15px]` | セクション見出し                           |
| `text-base`   | ナビゲーションテキスト                     |
| `text-lg`     | ページ見出し（ジョブ詳細）                 |
| `text-xl`     | セクションタイトル（ジョブ一覧）           |
| `text-2xl`    | ブランドタイトル（認証画面「koe」）        |
| `text-[28px]` | デバイスコード表示                         |

### フォントウェイト

- `font-medium` — ボタンラベル・ナビ項目
- `font-semibold` — 見出し・タイトル・ブランド名

### モノスペース

`font-mono` を使う場面：タイムスタンプ、デバイスコード、チャンク数、再生時間。

## コンポーネントパターン

### ボタン

```
// Primary（塗り）
bg-text-primary text-white rounded-button hover:opacity-90

// Secondary（枠線）
border border-border text-text-primary rounded-button hover:bg-surface

// Disabled
disabled:opacity-50
```

アイコンとテキストの間隔は `gap-1` 〜 `gap-1.5`。アイコンサイズは `12` 〜 `14`。

### カード

```
rounded-card bg-white p-3.5〜p-4 shadow-card
```

認証モーダル、録音パネル、トピック表示、クイック文字起こし結果に使用。

### ステータスバッジ

```
inline-block rounded-badge px-2 py-0.5 text-[11px] font-medium
```

| ステータス | 色                            |
| ---------- | ----------------------------- |
| pending    | `bg-[#fef3c7] text-[#92400e]` |
| processing | `bg-brand-light text-brand`   |
| completed  | `bg-[#dcfce7] text-[#166534]` |
| failed     | `bg-[#fee2e2] text-error`     |

### サイドバー

```
aside w-60 flex-col border-r border-r-[rgba(0,0,0,0.03)] bg-white
```

- ロゴ: `Mic` アイコン + "koe" テキスト
- ナビ項目（アクティブ）: `bg-surface font-medium text-text-primary rounded-md`
- ナビ項目（非アクティブ）: `text-text-secondary hover:bg-surface/50`
- ユーザー: アバター + メール + ログアウトボタン（border-t で区切り）

### ツールバー

各コンテンツエリアの上部に配置。

```
flex items-center justify-between
├── h1 text-xl font-semibold  <!-- ページタイトル -->
└── div flex gap-2            <!-- アクションボタン群 -->
```

### フォーム要素

```
// セレクト
w-full rounded-button border border-border px-3 py-1.5 text-xs text-text-primary
```

### ローディングスピナー

```
animate-spin rounded-full border-2 border-brand border-t-transparent
```

サイズ: `h-6 w-6`（ページ）/ `h-5 w-5`（セクション）/ `h-3.5 w-3.5`（インライン）

## レイアウト

### 全体構造（マスター/ディテール）

```
<div class="flex min-h-screen bg-surface">
  <Sidebar />           <!-- w-60 固定、bg-white -->
  <main class="flex-1 overflow-auto">
    <Toolbar />          <!-- タイトル + アクション -->
    <!-- コンテンツ -->
  </main>
</div>
```

認証前は AuthScreen をフルスクリーン表示（サイドバーなし）。

### スペーシング

- コンテンツエリア padding: `p-6`
- セクション間: `gap-5`
- カード内 padding: `p-4` 〜 `p-6`
- 要素間 gap: `gap-1.5` 〜 `gap-3`

### 分割レイアウト

クイック文字起こし画面で使用：

```
flex gap-5
├── w-1/2  <!-- 入力（録音・ファイル選択） -->
└── w-1/2  <!-- 結果（トランスクリプト・トピック） -->
```

### 空状態

コンテンツが存在しない場合は必ず空状態を表示する。

```
flex flex-1 flex-col items-center justify-center gap-3
├── アイコン（32-40px、text-text-secondary/40）
├── タイトル（text-[15px] font-semibold）
└── 説明テキスト（text-[13px] text-text-secondary、中央揃え）
```

## アイコン

lucide-react を使用。自作 SVG は使わない。

| アイコン        | 用途                             |
| --------------- | -------------------------------- |
| `Mic`           | ロゴ・録音ボタン                 |
| `AudioWaveform` | サイドバー「クイック文字起こし」 |
| `List`          | サイドバー「ジョブ一覧」         |
| `Plus`          | 新規ジョブ                       |
| `Upload`        | ファイルインポート               |
| `LogOut`        | ログアウト                       |
| `ArrowLeft`     | 戻るナビゲーション               |
| `ExternalLink`  | 外部リンク（認証）               |
| `Square`        | 録音停止                         |
| `RotateCcw`     | やり直し                         |

サイズは `12` 〜 `22`。通常 `12` 〜 `14` を使用。

## UI 設計方針

Apple Human Interface Guidelines に基づく。
参照: https://developer.apple.com/jp/design/human-interface-guidelines/

### 構造

- **サイドバー + マスター/ディテール** — 左カラムにナビとジョブリストを常時表示。右側にコンテンツ。ページ遷移はしない
- **ツールバー** — 各コンテンツエリア上部にタイトル + アクションボタン
- **段階的開示** — サイドバーで概要、ディテールで詳細。情報を一度に出さない

### フィードバック

- すべてのデータ表示には **空状態** を用意する（アイコン + 説明テキスト）
- 処理中のジョブはサイドバーで **ステータスを常時表示** する
- 破壊的アクション（削除等）は **確認ダイアログ** を挟む

### 操作性

- 主要操作には **キーボードショートカット** を割り当てる（`⌘N` 新規、`⌘I` インポート等）
- 音声ファイルの **ドラッグ&ドロップ** によるインポートに対応する
- ジョブの **右クリックコンテキストメニュー** で操作できるようにする

### アクセシビリティ

- `aria-label` とフォーカス管理を適切に設定する
- コントラスト比 4.5:1 以上を維持する
- `prefers-reduced-motion` を尊重し、不要なアニメーションを無効化する

## ビジュアル原則

- テキストは `#222222`（暖色系ニアブラック）。純粋な黒 `#000000` は使わない
- ブランドカラー `#ff385c` は CTA とアクセントのみ。広い面積の背景には使わない
- 角丸は大きめ（ボタン 8px、バッジ 14px、カード 20px）
- シャドウは 3 層構造で自然な浮き上がり。カード以外はボーダー `border-[rgba(0,0,0,0.03)]` で区切る
- コンパクトなサイズ感（text-xs ボタン、text-[13px] 本文）
- フォントウェイトは medium 以上。thin/light は使わない
