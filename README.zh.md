<div align="right">
  <sup>
    <a href="./README.md">EN</a> &nbsp;|&nbsp; <a href="./README.de.md">DE</a> &nbsp;|&nbsp; <b>中文</b> &nbsp;|&nbsp; <a href="./README.es.md">ES</a> &nbsp;|&nbsp; <a href="./README.ja.md">日本語</a> &nbsp;|&nbsp; <a href="./README.fr.md">FR</a> &nbsp;|&nbsp; <a href="./README.ru.md">RU</a>
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

  <p><b>为人类和机器构建的文档。</b><br/>一份 Markdown 源文件 → 网站、搜索、AI 上下文、Agent 协议。一次构建，全部生成。</p>

  <p>
    <a href="https://www.npmjs.com/package/@docmd/core"><img src="https://img.shields.io/npm/v/@docmd/core.svg?style=flat-square&color=CB3837" alt="npm version"></a>
    <a href="https://www.npmjs.com/package/@docmd/core?activeTab=versions"><img src="https://img.shields.io/npm/dm/@docmd/core.svg?style=flat-square&color=38bd24" alt="月下载量"></a>
    <a href="https://github.com/docmd-io/docmd"><img src="https://img.shields.io/github/stars/docmd-io/docmd?style=flat-square&logo=github" alt="GitHub stars"></a>
    <a href="https://github.com/docmd-io/docmd/blob/main/LICENSE"><img src="https://img.shields.io/github/license/docmd-io/docmd.svg?style=flat-square&color=A31F34" alt="开源协议"></a>
  </p>

  <h4>
    <a href="https://docmd.io">官方网站</a> &nbsp;·&nbsp;
    <a href="https://docs.docmd.io/zh/">文档中心</a> &nbsp;·&nbsp;
    <a href="https://cloud.docmd.io">AI 云中继</a> &nbsp;·&nbsp;
    <a href="https://live.docmd.io">在线编辑器</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd-skills">Agent Skills</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd/issues">提交 Feedback</a>
  </h4>

  <br/>

  <a href="https://docs.docmd.io/zh/">
    <img width="820" alt="docmd 默认主题 — 亮色与暗色模式预览" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-cover.webp" />
  </a>

  <br/><br/>

</div>

> ## ✦ 0.9 系列 — AI、自动化与安全
>
> 0.9.x 系列是 docmd 从面向 AI 的文档生成器跨越为同时服务于**人类与 AI Agent** 的文档平台的重要阶段。
>
> 该系列引入了 **AI 助手**，支持使用您自有的 API 密钥、本地 AI 语言模型，或通过 **docmd Cloud Relay（云中继）** 为无需后端支持的静态站点提供对话式文档问答。此外，还通过 MCP、自动生成的 LLM 上下文、Agent Skills 以及结构化知识格式，全面扩展了 docmd 的 AI 生态。
>
> 在 AI 功能之外，该系列重点关注**安全性、隐私保护与自动化**，同时持续优化核心文档体验、搜索引擎、部署流程与开发者工作流。
>
> [关注 0.9 路线图 →](https://github.com/orgs/docmd-io/discussions/10)

## 快速开始

在任意包含 Markdown 文件的文件夹中直接运行 docmd — 无需预先安装：

```bash
npx @docmd/core dev
```

<details>
  <summary><b>启动后可通过 <code>http://localhost:3000</code> 访问</b></summary><br>

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

导航栏会根据您的目录文件结构自动生成。无需配置文件、无需 Frontmatter、无需学习复杂的框架语法。

**准备部署发布时：**

```bash
npx @docmd/core build
```

命令将生成高度优化的静态单页应用 (SPA)，可直接部署至 Vercel、Cloudflare Pages、Netlify、GitHub Pages 或任意静态托管服务商。

**环境要求：** Node.js 18+

<details>
  <summary><b>或通过全局安装 / Docker 方式运行</b></summary><br/>

```bash
# 通过 npm 全局安装
npm install -g @docmd/core

# 或通过 pnpm
pnpm add -g @docmd/core

# 运行命令
docmd dev    # 启动本地开发服务器
docmd build  # 构建生产部署静态文件
```

或通过 Docker 运行：

```bash
docker run -p 3000:3000 ghcr.io/docmd-io/docmd:0.9.0
```

> 建议固定版本号以确保可重复构建。

</details>

## 为什么选择 docmd？

<div align="center">
  <img width="1000" alt="image" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-comparison.webp" />
</div>

<!--
| 功能特性 | docmd | Docusaurus | MkDocs | VitePress | Mintlify |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **必需配置文件** | **无** | `docusaurus.config.js` | `mkdocs.yml` | `config.mts` | `docs.json` |
| **JS 体积** | **~18 kb** | ~250 kb | ~40 kb | ~50 kb | ~120 kb |
| **页面导航** | **极速 SPA** | React SPA | 全页刷新 | Vue SPA | 托管 SPA |
| **版本控制** | **原生内置** | 原生 (较复杂) | mike 插件 | 手动配置 | 原生内置 |
| **多语言 i18n** | **原生内置** | 原生 (较复杂) | 依赖插件 | 原生内置 | 原生内置 |
| **多项目 Workspace** | **原生内置** | 插件扩展 | 插件扩展 | - | - |
| **搜索引擎** | **内置** | Algolia (云端) | 内置 | MiniSearch | 云端 |
| **AI 助手** | **内置 — BYOK + Cloud Relay** | - | - | - | 内置 (云端) |
| **AI 上下文 (`llms.txt`)** | **原生内置** | - | - | - | 原生内置 |
| **MCP 服务器** | **原生内置** | - | - | - | 原生内置 |
| **Agent Skills** | **原生内置** | - | - | - | - |
| **Docker 镜像** | **官方提供** | - | 官方提供 | - | - |
| **私有化自部署** | **支持** | 支持 | 支持 | 支持 | - |
| **开源免费** | **免费 (OSS)** | 免费 (OSS) | 免费 (OSS) | 免费 (OSS) | Freemium |
-->

**查看与 Docusaurus、Mintlify 等的 [完整对比 →](https://docs.docmd.io/zh/comparison/)**

## 核心特性

### 零配置，即刻运行
将 docmd 指向任意 Markdown 文件夹即可直接启动。导航目录会根据文件目录结构自动构建。一分钟内即可完成第一份文档的编写与上线 — 无需配置样板文件，无需搭建构建流水线。

### 极致轻量，流畅无阻
无框架运行时 — 输出标准的静态 HTML 和极简原生 JavaScript。页面间秒级 SPA 无缝无刷新跳转。天然具备 SEO 优化，内置 sitemap、规范链接 (canonical URLs) 及 Open Graph 社交元数据。内置离线全文搜索，无需任何第三方云服务。

### AI 原生架构
docmd 将 AI 视为了解与消费文档的首要方式 — 但同时保留了文档本身的良好阅读体验。
- **AI 助手 (`@docmd/plugin-ai`)** — 基于您自身文档的 RAG 检索引擎小组件。使用您自己的 API 密钥或连接本地 AI 提供商，通过 AIPlug 支持 100+ 种主流 AI 服务商。
- **Cloud Relay（云中继）** — 在静态文档站点上直接启用 AI 助手，无需自主运维 AI 后端服务。[即刻体验 →](https://cloud.docmd.io)
- **MCP 服务器** — `docmd mcp` 通过 stdio 向 AI Agent 暴露文档，支持 AI Agent 直接检索、阅读与校验文档内容。
- **上下文文件 (`llms.txt` / `llms-full.txt`)** — 构建时自动生成完整的文档上下文，随时供大语言模型消费。
- **Agent Skills** — 针对 LLM 和 IDE Agent 的模块化指令集。
- **Open Knowledge Format (OKF)** — 结构化、多语言的 AI 系统知识包。
- **复制为 Markdown / 复制上下文** — 浏览器内一键提炼文档上下文，完美适配粘贴至 AI 对话框。

### 专为规模化拓展打造
- 原生多语言国际化支持（分语言搜索引擎索引、llms、okf 及 hreflang 标签）
- 多版本文档管理（自动识别与标记当前最新版本）
- 支持大型 Monorepo 与多项目协同的 Workspaces
- 灵活强劲的插件系统（支持 Hook 返回值校验与异步支持）
- 全面主题自订，内置现代精美模板，支持自定义 CSS/JS，内置深浅色模式切换

## 命令行 (CLI)

```bash
docmd dev            # 启动本地开发服务器
docmd build          # 构建生产部署静态文件
docmd live           # 启动基于浏览器的 Live 在线编辑器
docmd init           # 在当前目录下生成 docmd.config.json 配置文件模板
docmd stop           # 停止当前后台运行的 `docmd dev` / `docmd live` 服务
docmd doctor         # 环境与插件安装状态排查诊断
docmd migrate        # 从 Docusaurus, VitePress, MkDocs 或 Starlight 迁移至 docmd
docmd deploy         # 自动生成适用于 Docker, NGINX, Caddy, Vercel, Netlify 的部署配置
docmd validate       # 检查所有内部死链与锚点引用
docmd mcp            # 通过 stdio 启动 MCP 服务器
docmd add <name>     # 快速安装插件或主题模板
```

## 插件生态

核心功能由稳健的插件系统驱动。基础功能默认内置，您亦可根据需求自由安装可选插件。

| 插件名称 | 状态 | 功能描述 |
| :--- | :---: | :--- |
| `ai` | 核心 | RAG 强力的 AI 助手，支持 BYOK、本地模型及云中继 |
| `search` | 核心 | 离线全文检索（关键词匹配 + 可选 `docmd-search` 语义检索） |
| `seo` | 核心 | SEO 元数据与 Open Graph 标签注入 |
| `sitemap` | 核心 | 自动生成 `sitemap.xml` |
| `git` | 核心 | Git 提交历史与页面最后更新时间统计 |
| `analytics` | 核心 | 轻量无追踪站点访问统计 |
| `llms` | 核心 | AI 上下文生成 (`llms.txt` / `llms-full.txt`) |
| `okf` | 核心 | 分语言 Open Knowledge Format 结构化知识包 |
| `mermaid` | 核心 | Mermaid 流程图与图表渲染 |
| `openapi` | 核心 | 构建期 OpenAPI 3.x 接口文档渲染器 |
| `pwa` | 可选 | Progressive Web App — 离线浏览能力 |
| `threads` | 可选 | 行内文档评论与讨论组 *(由 @svallory 贡献)* |
| `math` | 可选 | KaTeX / LaTeX 数学公式渲染 |

安装可选插件：

```bash
docmd add <plugin-name>
```

开发您自己的插件：[插件开发指南](https://docs.docmd.io/zh/development/building-plugins/)

## 配置文件

开始使用无需任何配置。仅在需要精细化控制时，在根目录下创建 `docmd.config.json`（或 `.ts` / `.js`）：

```json
{
  "title": "我的项目文档",
  "url": "https://docs.myproject.com",
  "src": "./docs",
  "out": "./dist"
}
```

支持使用 TypeScript / JavaScript 配置文件以注入动态配置。

完整配置参考：[配置选项总览](https://docs.docmd.io/zh/configuration/overview)

## 项目结构示例

```text
my-docs/
├── docs/                ← 存放您的 Markdown 格式文档
├── assets/              ← 图片与静态资源文件
├── docmd.config.json    ← 可选的项目配置文件
└── package.json
```

## 在线编辑器 (Live Editor)

无需本地搭建开发环境，直接在浏览器中即时撰写与预览文档。

**立即体验：[live.docmd.io](https://live.docmd.io)**

## Node.js Programmatic API

在 Node.js 脚本、CI 流水线或自定义构建任务中调用 docmd（同时兼容 CommonJS 与 ESM 模块）。

```javascript
import { build } from '@docmd/core';

await build('./docmd.config.json', { isDev: false });
```

完整参考文档：[Node API 参考指南](https://docs.docmd.io/zh/development/node-api-reference/)

## 社区与交流

- **提交 Bug 与问题** → [GitHub Issues](https://github.com/docmd-io/docmd/issues)
- **提问与想法交流** → [Discussions 论坛](https://github.com/orgs/docmd-io/discussions)
- **参与贡献** → [CONTRIBUTING.md](.github/CONTRIBUTING.md)
- **路线图规划** → [GitHub Discussions 讨论区](https://github.com/orgs/docmd-io/discussions/2)

## 支持项目

- 向身边的朋友推广是支持 docmd 发展最直接有效的方式。[在 X / Twitter 上分享](https://twitter.com/intent/tweet?url=https://github.com/docmd-io/docmd&text=docmd%20-%20为人类和机器构建的文档。) 或点亮一个 Star。
- 如果 docmd 为您节省了时间，非常欢迎通过 [GitHub Sponsor 赞助项目](https://github.com/sponsors/mgks)。
- 想法或 Bug 反馈？欢迎提交 Issue 或 Pull Request，也十分欢迎贡献您自制的插件！

## 开源协议

基于 MIT License 开源协议。详见 [`LICENSE`](./LICENSE) 文件。