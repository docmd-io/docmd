<div align="right">
  <sup>
    <a href="./README.md">EN</a> &nbsp;|&nbsp; <a href="./README.de.md">DE</a> &nbsp;|&nbsp; <a href="./README.zh.md">中文</a> &nbsp;|&nbsp; <a href="./README.es.md">ES</a> &nbsp;|&nbsp; <b>日本語</b> &nbsp;|&nbsp; <a href="./README.fr.md">FR</a> &nbsp;|&nbsp; <a href="./README.ru.md">RU</a>
  </sup>
</div>

<div align="center">

  <a href="https://docmd.io">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://github.com/docmd-io/docmd/blob/main/packages/ui/assets/images/docmd-logo-dark.png?raw=true" />
      <source media="(prefers-color-scheme: light)" srcset="https://github.com/docmd-io/docmd/blob/main/packages/ui/assets/images/docmd-logo-dark.png?raw=true" />
      <img src="https://github.com/docmd-io/docmd/blob/main/packages/ui/assets/images/docmd-logo-dark.png?raw=true" alt="docmd" width="210" />
    </picture>
  </a>

  <br/>

  <p><b>人間と機械のためのドキュメント。</b><br/>ひとつの Markdown ソース → ウェブサイト、検索、AI コンテキスト、エージェントプロトコル。すべてをまとめて生成。</p>

  <p>
    <a href="https://www.npmjs.com/package/@docmd/core"><img src="https://img.shields.io/npm/v/@docmd/core.svg?style=flat-square&color=CB3837" alt="npm version"></a>
    <a href="https://www.npmjs.com/package/@docmd/core?activeTab=versions"><img src="https://img.shields.io/npm/dm/@docmd/core.svg?style=flat-square&color=38bd24" alt="月間ダウンロード数"></a>
    <a href="https://github.com/docmd-io/docmd"><img src="https://img.shields.io/github/stars/docmd-io/docmd?style=flat-square&logo=github" alt="GitHub stars"></a>
    <a href="https://github.com/docmd-io/docmd/blob/main/LICENSE"><img src="https://img.shields.io/github/license/docmd-io/docmd.svg?style=flat-square&color=A31F34" alt="ライセンス"></a>
  </p>

  <h4>
    <a href="https://docmd.io">公式ウェブサイト</a> &nbsp;·&nbsp;
    <a href="https://docs.docmd.io/ja/">ドキュメント</a> &nbsp;·&nbsp;
    <a href="https://cloud.docmd.io">AI Cloud Relay</a> &nbsp;·&nbsp;
    <a href="https://live.docmd.io">ライブエディタ</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd-skills">Agent Skills</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd/issues">バグを報告</a>
  </h4>

  <br/>

  <a href="https://docs.docmd.io/ja/">
    <img width="820" alt="docmd デフォルトテーマ — ライト＆ダークモード プレビュー" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-cover.webp" />
  </a>

  <br/><br/>

</div>

> ## ✦ 0.9 シリーズ — AI、自動化、セキュリティ
>
> 0.9.x シリーズは、docmd が AI 対応のドキュメントジェネレーターから、**人間と AI エージェントの両方**のために設計されたドキュメントプラットフォームへと拡張する重要なリリースです。
>
> このシリーズでは **AI アシスタント** が導入され、独自の API キー、ローカル AI、または独自のバックエンドを持たない静的サイト向けの **docmd Cloud Relay** を使用して、対話形式でドキュメントを検索できるようになります。また、MCP、生成された LLM コンテキスト、Agent Skills、構造化ナレッジフォーマットにより、docmd の AI エコシステムが拡張されます。
>
> AI に加え、コアなドキュメント体験、検索、デプロイ、開発者ワークフローの改善を継続しながら、**セキュリティ、プライバシー、自動化** に焦点を当てています。
>
> [0.9 ロードマップを追う →](https://github.com/orgs/docmd-io/discussions/10)

## クイックスタート

Markdown ファイルが含まれる任意のフォルダで docmd を実行できます（インストール不要）:

```bash
npx @docmd/core dev
```

<details>
  <summary><b><code>http://localhost:3000</code> で開きます</b></summary><br>

```bash
    _                 _ 
  _| |___ ___ _____ _| |
 | . | . |  _|     | . |
 |___|___|___|_|_|_|___|

 v0.9.0

BUILD
  Engine          JS
  Source          docs/
  Output          site/
  Versions        2 (06, 05)
  Locales         7 (en, hi, zh, es, de, ja, fr)

DATA INDEXING
  [ DONE ] Syncing git metadata
  [ DONE ] Building search index & RAG embeddings (multi-version)
  [ DONE ] Generating AI Assistant RAG context

PUBLISHING
  [ DONE ] Generated robots.txt
  [ DONE ] Generated .nojekyll (disables Jekyll on GitHub Pages)
  [ DONE ] Generated sitemap
  [ DONE ] Generating LLMs context files (llms.txt)
  [ DONE ] Generating OKF bundles

⬢ Initial build completed in 1.2s.

WATCHING
  Source          ./docs
  Config          ./docmd.config.json
  Assets          ./assets

DEVELOPMENT SERVER RUNNING
  Local Access    http://127.0.0.1:3000
  Network Access  http://192.168.1.6:3000
  Serving from    ./site
```

</details>

ナビゲーションはファイル構造から自動生成されます。設定ファイル、Frontmatter、特別なフレームワークの学習は一切不要です。

**本番デプロイの準備が整ったら:**

```bash
npx @docmd/core build
```

Vercel、Cloudflare Pages、Netlify、GitHub Pages、またはその他の静的ホスティングに即座にデプロイ可能な高最適化静的サイト（SPA）が出力されます。

**動作要件:** Node.js 18+

<details>
  <summary><b>またはグローバルインストール / Docker 経由で実行</b></summary><br/>

```bash
# npm でグローバルインストール
npm install -g @docmd/core

# または pnpm
pnpm add -g @docmd/core

# 実行
docmd dev    # 開発サーバー起動
docmd build  # 本番ビルド
```

または Docker 経由で実行:

```bash
docker run -p 3000:3000 ghcr.io/docmd-io/docmd:0.9.0
```

> 再現可能なビルドのためにバージョンを固定することを推奨します。

</details>

## なぜ docmd なのか？

<div align="center">
  <img width="1000" alt="image" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-comparison.webp" />
</div>

<!--
| 機能 | docmd | Docusaurus | MkDocs | VitePress | Mintlify |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **設定の要否** | **不要** | `docusaurus.config.js` | `mkdocs.yml` | `config.mts` | `docs.json` |
| **JS ペイロード** | **~18 kb** | ~250 kb | ~40 kb | ~50 kb | ~120 kb |
| **画面遷移** | **高速 SPA** | React SPA | フルリロード | Vue SPA | ホスト型 SPA |
| **バージョン管理** | **標準対応** | 標準対応 (複雑) | mike プラグイン | 手動 | 標準対応 |
| **多言語対応 (i18n)** | **標準対応** | 標準対応 (複雑) | プラグイン依存 | 標準対応 | 標準対応 |
| **マルチプロジェクト** | **標準対応** | プラグイン | プラグイン | - | - |
| **検索機能** | **内蔵** | Algolia (クラウド) | 内蔵 | MiniSearch | クラウド |
| **AI アシスタント** | **内蔵 — BYOK + Cloud Relay** | - | - | - | 内蔵 (クラウド) |
| **AI コンテキスト (`llms.txt`)** | **標準対応** | - | - | - | 標準対応 |
| **MCP サーバー** | **標準対応** | - | - | - | 標準対応 |
| **Agent Skills** | **標準対応** | - | - | - | - |
| **Docker イメージ** | **公式提供** | - | 公式提供 | - | - |
| **セルフホスト** | **対応** | 対応 | 対応 | 対応 | - |
| **費用** | **無料 (OSS)** | 無料 (OSS) | 無料 (OSS) | 無料 (OSS) | Freemium |
-->

**[Docusaurus、Mintlify などとの完全な比較を見る →](https://docs.docmd.io/comparison/)**

## 主な特徴

### 設定不要、即座にスタート
Markdown フォルダを指定するだけで docmd が起動します。ファイル階層構造からナビゲーションが自動構築されるため、設定ファイルや事前設計なしで 1 分以内に最初のドキュメントを公開可能です。

### 超軽量、どこでも高速
デフォルトの JavaScript ペイロードは僅か約 18 kb。高速な SPA 画面遷移を実現します。出力は SEO に最適化された静的 HTML で、サイトマップ、カノニカル URL、Open Graph メタデータが含まれます。クラウド不要のオフライン全文検索も内蔵しています。

### AI ネイティブ設計
docmd は、ドキュメント自体を置き換えることなく、現代におけるドキュメントの読み取り・活用方法として AI を第一級の要素として扱います。
- **AI アシスタント (`@docmd/plugin-ai`)** — あなたのドキュメントに基づく RAG 駆動のチャット。独自の API キーまたはローカル AI プロバイダーを使用でき、AIPlug 経由で 100 以上のプロバイダーをサポート。
- **Cloud Relay** — 独自バックエンドを運用することなく、静的ドキュメント上で AI アシスタントを有効化。[試してみる →](https://cloud.docmd.io)
- **MCP サーバー** — `docmd mcp` により stdio 経由で AI エージェントにドキュメントを公開し、直接検索・閲覧・検証を可能にします。
- **コンテキスト生成 (`llms.txt` / `llms-full.txt`)** — ビルド時に生成される完全なドキュメントコンテキスト。
- **Agent Skills** — LLM および IDE エージェント向けのモジュール式指示セット。
- **Open Knowledge Format (OKF)** — AI システム向けの構造化された多言語知識パッケージ。
- **Markdown / コンテキストとしてコピー** — ブラウザからワンクリックで抽出でき、AI チャットへの貼り付けに最適化。

### 拡張性と拡張機能
- 多言語マルチロケールビルド対応（言語ごとの検索インデックス、llms、okf、hreflang）
- 複数リリースのバージョン管理（現在の最新バージョンを自動認識）
- モノレポや複数プロジェクト構築のための Workspaces 機能
- コア機能を拡張する強固なプラグインシステム（Hook 毎の型検証、非同期処理対応）
- テーマカスタマイズ、組み込みテンプレート、カスタム CSS/JS、ライト/ダークモード対応

## CLI

```bash
docmd dev            # ローカル開発サーバー起動
docmd build          # 本番用静的サイトビルド
docmd live           # ブラウザベースの Live エディタ起動
docmd init           # カレントフォルダに docmd.config.json を初期化
docmd stop           # 実行中の `docmd dev` / `docmd live` サーバーを停止
docmd doctor         # 設定とプラグインの診断チェック
docmd migrate        # Docusaurus, VitePress, MkDocs, Starlight からの移行
docmd deploy         # Docker, NGINX, Caddy, Vercel, Netlify 用設定の自動生成
docmd validate       # 内部リンクとアンカーの死線チェック
docmd mcp            # stdio 経由で MCP サーバーとして実行
docmd add <name>     # プラグインまたはテンプレートの追加
```

## プラグイン

コア機能は強固なプラグインシステムによって駆動されます。基本機能はデフォルトで含まれており、必要に応じてオプションのプラグインを追加できます。

| プラグイン | ステータス | 説明 |
| :--- | :---: | :--- |
| `ai` | コア | BYOK、ローカルプロバイダー、Cloud Relay 対応の RAG 駆動 AI アシスタント |
| `search` | コア | オフライン全文検索（キーワード検索 ＋ `docmd-search` 経由のセマンティック検索） |
| `seo` | コア | SEO タグおよび Open Graph メタデータ生成 |
| `sitemap` | コア | `sitemap.xml` の自動生成 |
| `git` | コア | Git コミット履歴と最終更新日時の取得 |
| `analytics` | コア | 軽量アクセス解析インテグレーション |
| `llms` | コア | AI コンテキストファイル生成 (`llms.txt` / `llms-full.txt`) |
| `okf` | コア | AI エージェント向け Open Knowledge Format パッケージ（ロケール別） |
| `mermaid` | コア | Mermaid ダイアグラム表示対応 |
| `openapi` | コア | ビルド時の OpenAPI 3.x 仕様レンダラー |
| `pwa` | オプション | Progressive Web App — オフライン閲覧 |
| `threads` | オプション | インラインディスカッションスレッド *(by @svallory)* |
| `math` | オプション | KaTeX / LaTeX 数式レンダリング |

オプションプラグインの追加:

```bash
docmd add <plugin-name>
```

独自プラグインの作成: [プラグイン開発ガイド](https://docs.docmd.io/ja/development/building-plugins/)

## 設定

開発を開始するにあたり設定ファイルは一切不要です。より詳細な制御が必要な場合のみ、ルートディレクトリに `docmd.config.json` (または `.ts` / `.js`) を作成してください:

```json
{
  "title": "マイプロジェクト",
  "url": "https://docs.myproject.com",
  "src": "./docs",
  "out": "./dist"
}
```

動的な値を扱うための TypeScript および JavaScript 設定ファイルもサポートされています。

詳細な設定オプション: [設定リファレンス](https://docs.docmd.io/ja/configuration/overview)

## プロジェクト構造例

```text
my-docs/
├── docs/                ← Markdown ドキュメント
├── assets/              ← 画像や静的ファイル
├── docmd.config.json    ← 任意の設定ファイル
└── package.json
```

## ライブエディタ (Live Editor)

ローカル環境の構築不要で、ブラウザ上で直接ドキュメントの執筆とプレビューが可能です。

**[live.docmd.io](https://live.docmd.io) で試す**

## Node.js Programmatic API

Node.js スクリプト、CI パイプライン、カスタムビルドステップから docmd を利用可能です。（CommonJS および ESM 両対応）

```javascript
import { build } from '@docmd/core';

await build('./docmd.config.json', { isDev: false });
```

詳細リファレンス: [Node API リファレンス](https://docs.docmd.io/ja/development/node-api-reference/)

## コミュニティ

- **バグ・不具合報告** → [GitHub Issues](https://github.com/docmd-io/docmd/issues)
- **質問・アイデア** → [Discussions](https://github.com/orgs/docmd-io/discussions)
- **貢献方法** → [CONTRIBUTING.md](.github/CONTRIBUTING.md)
- **ロードマップ** → [GitHub Discussions](https://github.com/orgs/docmd-io/discussions/2)

## 支援・サポート

- docmd の開発を最も直接的に支援する方法は、周囲の開発者に共有することです。[X で共有する](https://twitter.com/intent/tweet?url=https://github.com/docmd-io/docmd&text=docmd%20-%20人間と機械のためのドキュメント。) か、スターを付けてください。
- docmd が開発時間の節約に役立った場合は、[GitHub スポンサー](https://github.com/sponsors/mgks) をご検討ください。
- アイデアやバグ報告、独自プラグインの PR も大歓迎です！

## ライセンス

MIT ライセンス。詳細は [`LICENSE`](./LICENSE) を参照してください。