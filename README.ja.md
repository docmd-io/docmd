<div align="right">
  <sup>
    <a href="./README.md">EN</a> &nbsp;|&nbsp; <a href="./README.de.md">DE</a> &nbsp;|&nbsp; <a href="./README.zh.md">中文</a> &nbsp;|&nbsp; <a href="./README.es.md">ES</a> &nbsp;|&nbsp; <b>日本語</b> &nbsp;|&nbsp; <a href="./README.fr.md">FR</a> &nbsp;|&nbsp; <a href="./README.ru.md">RU</a> &nbsp;|&nbsp; <a href="./README.tr.md">TR</a>
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

  <p>
    <b>人間と機械のためのドキュメント。</b><br/>
    ひとつの Markdown ソース → ウェブサイト、検索、AI コンテキスト、エージェント、ナレッジフォーマット。
  </p>

  <p>
    <a href="https://www.npmjs.com/package/@docmd/core"><img src="https://img.shields.io/npm/v/@docmd/core.svg?style=flat-square&color=CB3837" alt="npm version"></a>
    <a href="https://www.npmjs.com/package/@docmd/core?activeTab=versions"><img src="https://img.shields.io/npm/dm/@docmd/core.svg?style=flat-square&color=38bd24" alt="月間ダウンロード数"></a>
    <a href="https://github.com/docmd-io/docmd"><img src="https://img.shields.io/github/stars/docmd-io/docmd?style=flat-square&logo=github" alt="GitHub stars"></a>
    <a href="https://github.com/docmd-io/docmd/blob/main/LICENSE"><img src="https://img.shields.io/github/license/docmd-io/docmd.svg?style=flat-square&color=A31F34" alt="ライセンス"></a>
  </p>

  <h4>
    <a href="https://docmd.io">ウェブサイト</a> &nbsp;·&nbsp;
    <a href="https://docs.docmd.io">ドキュメント</a> &nbsp;·&nbsp;
    <a href="https://cloud.docmd.io">Cloud Relay</a> &nbsp;·&nbsp;
    <a href="https://live.docmd.io">ライブエディタ</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd-skills">Agent Skills</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd/issues">Issues</a>
  </h4>

  <br/>

  <a href="https://docmd.io">
    <img width="820" alt="docmd ドキュメント — ライト＆ダークモードのプレビュー" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-cover.webp" />
  </a>

</div>

## クイックスタート

Markdown ファイルが含まれるフォルダを docmd に指定して実行します:

```bash
npx @docmd/core dev
```

`http://localhost:3000` を開きます。

これだけです。ファイル構造からナビゲーションが自動生成されます。設定ファイル、フロントマター、フレームワークの学習は不要です。

デプロイの準備ができたら:

```bash
npx @docmd/core build
```

docmd は、Vercel、Cloudflare Pages、Netlify、GitHub Pages、S3、NGINX、Caddy など、あらゆる静的ホストにデプロイ可能な静的サイトを生成します。

**Node.js 20+ が必要です。**

<details>
  <summary><b>グローバルインストールと Docker</b></summary>

<br/>

グローバルインストール:

```bash
npm install -g @docmd/core

# または
pnpm add -g @docmd/core
```

次に:

```bash
docmd dev
docmd build
```

または Docker で実行:

```bash
docker run -p 3000:3000 ghcr.io/docmd-io/docmd:latest
```

> 再現可能な本番ビルドを行うには、Docker イメージを特定のリリースバージョンに固定してください。

</details>

## ひとつのソース、あらゆる出力形式

docmd はオープンソースのドキュメントコンパイラです。

Markdown を単なるウェブサイトの入力として扱うのではなく、docmd は同じソースを読者、検索エンジン、LLM、コーディングエージェント、ナレッジシステム向けの出力へとコンパイルします。

```text
Markdown
   │
   ▼
 docmd
   │
   ├── → 静的ドキュメントサイト
   ├── → オフライン検索インデックス
   ├── → llms.txt / llms-full.txt
   ├── → Open Knowledge Format (OKF)
   ├── → サイトマップ + SEO メタデータ
   ├── → robots.txt + Open Graph
   ├── → AI エージェント用 MCP インターフェース
   └── → AI アシスタント用コンテキスト
```

ひとつのソースツリー、ひとつのビルドパイプライン。ドキュメント用と AI ナレッジ用に別々のスタックを保守する必要はありません。

## なぜ docmd なのか？

現代のドキュメントには、複数の異なる読者が存在します。

人間には高速でナビゲートしやすいウェブサイトが必要です。検索エンジンには構造化メタデータが必要です。LLM にはクリーンなコンテキストが必要です。コーディングエージェントにはツールとプロトコルが必要です。RAG システムには構造化された知識が必要です。

docmd は、Markdown を中心に据えたまま、これらすべてを同時に構築します。

<a href="https://docs.docmd.io/comparison/">
  <img width="800" alt="他のドキュメントツールとの docmd 比較" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-comparison.webp" />
</a>
<br/>
<b><a href="https://docs.docmd.io/comparison/">Docusaurus、Mintlify、その他のドキュメントツールとの完全な比較を見る →</a></b>

## 主な機能

### 設定不要、即座にスタート

任意の Markdown フォルダを指定するだけで docmd が起動します。ファイル構造からナビゲーションが自動生成されるため、ボイラープレート、フロントマター、ビルドパイプラインの準備なしですぐに開始できます。

### デフォルトで軽量、どこでも高速

docmd は最小限のバニラ JavaScript と高速な SPA スタイルのナビゲーションを備えた静的 HTML を生成します。オフライン全文検索、サイトマップ、カノニカル URL、Open Graph メタデータなどの必需機能が出力に含まれています。

### AI およびエージェント対応

docmd は、機械可読なドキュメントを個別の公開フローではなく、ビルドプロセスの一部として扱います。

* **AI アシスタント** — ドキュメントに基づいた RAG 駆動のチャット
* **MCP サーバー** — 対応するコーディングエージェントによるドキュメントの検索、閲覧、検証
* **`llms.txt` / `llms-full.txt`** — LLM が読み取り可能な完全なドキュメントコンテキスト
* **Open Knowledge Format (OKF)** — AI および RAG システム向けの構造化ナレッジバンドル
* **Agent Skills** — LLM およびコーディングエージェント向けの再利用可能な指示セット
* **Markdown としてコピー / コンテキストをコピー** — ブラウザから直接クリーンなコンテキストを抽出
* **セマンティック検索** — 組み込みのキーワード検索に加え、オプションでベクトル検索に対応

### 拡張性とスケーラビリティ

* ロケール対応検索と生成出力を備えた多言語対応 (i18n)
* 複数のドキュメントリリースに対応したバージョン管理
* モノレポおよびマルチプロジェクト用の Workspaces
* API ドキュメント用 OpenAPI 3.x レンダリング
* 組み込みテンプレート、カスタム CSS/JavaScript、ライト/ダークモード

## AI アシスタント & Cloud Relay

docmd には、ドキュメントに基づいた RAG 駆動の AI アシスタントが含まれています。

独自のバックエンドやローカル AI プロバイダーに接続できます。ドキュメントを静的サイトとしてデプロイしている場合は、**docmd Cloud Relay** がホスト型ブリッジとして機能します。

```text
あなたのドキュメント
        │
        ▼
 @docmd/plugin-ai
        │
        ▼
 docmd Cloud Relay
        │
        ▼
 あなたの AI プロバイダー
```

Cloud Relay は選択したプロバイダーに安全に AI リクエストを送信するため、API クレデンシャルをブラウザに公開する必要がなく、AI バックエンドを運用する必要もありません。

**Cloud Relay はご自身の AI プロバイダーの API キーを使用して無料で利用できます。**

* 任意のプロバイダーとモデルを持ち込み可能
* プロバイダーの認証情報をクライアントから保護
* 静的ホスティングでそのまま動作
* デプロイや保守が必要な AI バックエンドが不要
* 利用状況の可視化と読者の質問傾向の把握
* 1 つのアカウントから複数のドキュメントプロジェクトを接続

**[Cloud Relay をセットアップ →](https://cloud.docmd.io)** • [AI アシスタント ドキュメント →](https://docs.docmd.io/guides/ai/ai-assistant/)

> Cloud Relay の利用は無料です。モデルの使用料は選択した AI プロバイダーによって別途請求される場合があります。

## CLI

```bash
docmd dev            # ローカル開発サーバーを起動
docmd build          # 本番用にビルド
docmd live           # ブラウザベースの Live エディタを起動
docmd init           # 設定ファイルを作成
docmd doctor         # 設定とプラグインの状態をチェック
docmd validate       # ドキュメントの内部リンクを検証
docmd migrate        # Docusaurus、VitePress、MkDocs、Starlight から移行
docmd deploy         # デプロイ設定を生成
docmd mcp            # stdio 経由で MCP サーバーを実行
docmd add <name>     # プラグインまたはテンプレートをインストール
docmd stop           # 実行中の docmd 開発サーバーを停止
```

**完全な [CLI コマンド一覧を見る →](https://docs.docmd.io/reference/cli-commands/)**

## プラグイン

docmd はプラグインシステムを中心に構築されています。一般的なドキュメント機能はコアに含まれており、必要に応じてオプションのプラグインをインストールできます。

| プラグイン  | ステータス | 説明                                                                 |
| :---------- | :--------: | :------------------------------------------------------------------- |
| `ai`        |    コア    | BYOK、ローカルプロバイダー、Cloud Relay 対応の RAG 駆動 AI アシスタント |
| `search`    |    コア    | オフラインキーワード検索（オプションでセマンティック検索に対応）     |
| `seo`       |    コア    | SEO および Open Graph メタデータ                                     |
| `sitemap`   |    コア    | `sitemap.xml` の生成                                                 |
| `git`       |    コア    | Git の履歴と最終更新メタデータ                                       |
| `analytics` |    コア    | 軽量なアクセス解析インテグレーション                                 |
| `llms`      |    コア    | `llms.txt` および `llms-full.txt` を生成                             |
| `okf`       |    コア    | Open Knowledge Format バンドル                                       |
| `mermaid`   |    コア    | Mermaid ダイアグラムのレンダリング                                   |
| `openapi`   |    コア    | OpenAPI 3.x ドキュメントレンダラー                                   |
| `pwa`       | オプション | Progressive Web App およびオフラインナビゲーション                   |
| `threads`   | オプション | インラインドキュメントディスカッション *(by @svallory)*              |
| `math`      | オプション | KaTeX / LaTeX レンダリング                                           |

オプションプラグインのインストール:

```bash
docmd add <plugin-name>
```

**独自プラグインの作成: [プラグイン開発ガイド →](https://docs.docmd.io/development/building-plugins/)**

## 設定

設定は任意です。

より詳細な制御が必要な場合は、プロジェクトのルートに `docmd.config.json`、`docmd.config.ts`、または `docmd.config.js` を追加してください:

```json
{
  "title": "マイプロジェクト",
  "url": "https://docs.myproject.com",
  "src": "./docs",
  "out": "./dist"
}
```

動的な値が必要な場合は、TypeScript および JavaScript の設定ファイルを使用できます。

**[設定リファレンス →](https://docs.docmd.io/configuration/overview)**

## プログラマティック API

Node.js スクリプト、CI パイプライン、またはカスタムビルドシステムから docmd を利用できます。

```javascript
import { build } from '@docmd/core';

// プログラムからドキュメントをビルド
await build('./docmd.config.json', { isDev: false });
```

CommonJS と ESM の両方をサポートしています。

**[Node API リファレンス →](https://docs.docmd.io/development/node-api-reference/)**

## 移行

既存のドキュメントをゼロから作り直す必要はありません。

```bash
docmd migrate
```

Docusaurus、VitePress、MkDocs、Starlight などのサポート対象ドキュメントフレームワーク用の移行ツールが用意されています。

**[移行ドキュメント →](https://docs.docmd.io)**

## オープンソース

ドキュメントはプロジェクトの知的資産の中核です。Git リポジトリ内のシンプルな Markdown ファイルとして管理されるべきであり、ポータブルでバージョン管理可能、かつ監査可能であるべきです。

**docmd コンパイラおよび公式コアプラグインは MIT ライセンスの下で提供されており、有料化されたコンパイラ機能なしで、永続的に無料で利用できます。**

生成されたドキュメントはどこにでもホストでき、docmd がホストするインフラを必要としません。

## コミュニティ

* **公式ドキュメント** → [docs.docmd.io](https://docs.docmd.io)
* **質問・アイデア** → [GitHub Discussions](https://github.com/orgs/docmd-io/discussions)
* **バグ報告・機能リクエスト** → [GitHub Issues](https://github.com/docmd-io/docmd/issues)
* **貢献方法** → [CONTRIBUTING.md](.github/CONTRIBUTING.md)
* **ロードマップ** → [GitHub Discussions](https://github.com/orgs/docmd-io/discussions/2)

## docmd を応援する

docmd が役に立ったら:

* リポジトリに ⭐ を付ける
* ドキュメントを作成している人に共有する
* Issue の起票、バグ修正の貢献、またはプラグインの開発
* [GitHub スポンサーで開発を支援](https://github.com/sponsors/mgks)

## ライセンス

MIT ライセンス。詳細は [LICENSE](LICENSE) を参照してください。