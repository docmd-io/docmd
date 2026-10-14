<div align="right">
  <sup>
    <a href="./README.md">EN</a> &nbsp;|&nbsp; <a href="./README.de.md">DE</a> &nbsp;|&nbsp; <b>中文</b> &nbsp;|&nbsp; <a href="./README.es.md">ES</a> &nbsp;|&nbsp; <a href="./README.ja.md">日本語</a> &nbsp;|&nbsp; <a href="./README.fr.md">FR</a> &nbsp;|&nbsp; <a href="./README.ru.md">RU</a> &nbsp;|&nbsp; <a href="./README.tr.md">TR</a>
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
    <b>为人类和机器构建的文档。</b><br/>
    一份 Markdown 源文件 → 网站、搜索、AI 上下文、Agent 和知识格式。
  </p>

  <p>
    <a href="https://www.npmjs.com/package/@docmd/core"><img src="https://img.shields.io/npm/v/@docmd/core.svg?style=flat-square&color=CB3837" alt="npm version"></a>
    <a href="https://www.npmjs.com/package/@docmd/core?activeTab=versions"><img src="https://img.shields.io/npm/dm/@docmd/core.svg?style=flat-square&color=38bd24" alt="月下载量"></a>
    <a href="https://github.com/docmd-io/docmd"><img src="https://img.shields.io/github/stars/docmd-io/docmd?style=flat-square&logo=github" alt="GitHub stars"></a>
    <a href="https://github.com/docmd-io/docmd/blob/main/LICENSE"><img src="https://img.shields.io/github/license/docmd-io/docmd.svg?style=flat-square&color=A31F34" alt="开源协议"></a>
  </p>

  <h4>
    <a href="https://docmd.io">官方网站</a> &nbsp;·&nbsp;
    <a href="https://docs.docmd.io">官方文档</a> &nbsp;·&nbsp;
    <a href="https://cloud.docmd.io">Cloud Relay</a> &nbsp;·&nbsp;
    <a href="https://live.docmd.io">在线编辑器</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd-skills">Agent Skills</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd/issues">Issues</a>
  </h4>

  <br/>

  <a href="https://docmd.io">
    <img width="820" alt="docmd 文档 — 浅色与深色模式预览" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-cover.webp" />
  </a>

</div>

## 快速开始

将 docmd 指向包含 Markdown 文件的文件夹：

```bash
npx @docmd/core dev
```

打开 `http://localhost:3000`。

大功告成。目录导航将根据您的文件结构自动生成。无需配置文件、Frontmatter 或学习任何框架。

准备好部署时：

```bash
npx @docmd/core build
```

docmd 会生成一个静态站点，可部署至 Vercel、Cloudflare Pages、Netlify、GitHub Pages、S3、NGINX、Caddy 或任何其他静态托管平台。

**环境要求：Node.js 20+。**

<details>
  <summary><b>全局安装与 Docker</b></summary>

<br/>

全局安装：

```bash
npm install -g @docmd/core

# 或
pnpm add -g @docmd/core
```

然后：

```bash
docmd dev
docmd build
```

或使用 Docker 运行：

```bash
docker run -p 3000:3000 ghcr.io/docmd-io/docmd:latest
```

> 建议将 Docker 镜像标签锁定到具体的发布版本，以实现可复现的生产构建。

</details>

## 单一源文件，全方位输出

docmd 是一款开源文档编译器。

docmd 不仅将 Markdown 视为网站的输入源，更能将同一份源文件统一编译输出给人类读者、搜索引擎、大语言模型 (LLM)、代码 Agent 以及知识系统。

```text
Markdown
   │
   ▼
 docmd
   │
   ├── → 静态文档站点
   ├── → 离线搜索索引
   ├── → llms.txt / llms-full.txt
   ├── → Open Knowledge Format (OKF)
   ├── → 站点地图 + SEO 元数据
   ├── → robots.txt + Open Graph
   ├── → 面向 AI Agent 的 MCP 接口
   └── → AI 助手上下文
```

一套源码，一条构建流水线。无需分别维护两套独立的文档与 AI 知识库技术栈。

## 为什么选择 docmd？

如今的文档正在迎来不止一种读者。

人类用户需要极速且便于导航浏览的网站；搜索引擎需要结构化的元数据；大语言模型需要纯净的上下文；代码 Agent 需要配套的工具与协议；RAG 系统则需要结构化的知识。

docmd 将这一切融为一体，并始终坚持以 Markdown 作为核心。

<a href="https://docs.docmd.io/comparison/">
  <img width="800" alt="docmd 与其他文档生成工具的对比" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-comparison.webp" />
</a>
<br/>
<b>查看与 <a href="https://docs.docmd.io/comparison/">Docusaurus、Mintlify 及其他文档工具的完整对比 →</a></b>

## 核心特性

### 零配置，即开即用

将 docmd 指向任意 Markdown 文件夹即可直接运行。导航目录根据文件结构自动生成 — 无需配置样板、Frontmatter 或构建流水线即可迅速启动。

### 极致轻量，处处飞快

docmd 生成基于极简原生 JavaScript 的静态 HTML，带来极速 SPA 级页面切换体验。离线全文检索、站点地图 (Sitemap)、规范网址、Open Graph 元数据等必备功能均直接内置于生成结果中。

### 原生支持 AI 与 Agent

docmd 将面向机器的文档视为构建流程的核心部分，而非独立拆分的发布任务。

* **AI 助手** — 基于自身文档的 RAG 对话问答
* **MCP 服务器** — 允许兼容的代码 Agent 检索、阅读与验证文档
* **`llms.txt` / `llms-full.txt`** — 供大模型直接消费的完整文档上下文
* **Open Knowledge Format (OKF)** — 专为 AI 与 RAG 系统定制的结构化知识包
* **Agent Skills** — 适用于大模型与 IDE Agent 的可复用指令集
* **复制为 Markdown / 复制上下文** — 在浏览器中一键提取格式纯净的文档上下文
* **语义检索** — 在内置关键词搜索的基础上，支持可选的向量语义检索

### 专为规模化拓展而生

* 原生多语言国际化，具备多语言检索与专属产物生成能力
* 支持多版本文档发行与维护
* 适用于 Monorepo 与多项目的 Workspaces 工作区
* OpenAPI 3.x 接口规范文档渲染
* 内置精美主题模板、自定义 CSS/JavaScript 以及深浅色模式

## AI 助手与 Cloud Relay

docmd 内置了基于您自身文档进行知识增强 (RAG) 的 AI 助手。

您可以将其连接到自己的后端或本地 AI 服务商。如果您的文档以纯静态站点形式部署，**docmd Cloud Relay（云中继）** 则可提供即开即用的托管桥接服务。

```text
您的文档
        │
        ▼
 @docmd/plugin-ai
        │
        ▼
 docmd Cloud Relay
        │
        ▼
 您的 AI 模型服务商
```

Cloud Relay 会安全地将 AI 请求转发至您指定的模型服务商，因此无需将 API 密钥暴露给前端浏览器，您也无需自主搭建和维护 AI 后端服务。

**搭配您自己的 AI 模型密钥，Cloud Relay 完全免费使用。**

* 自带模型服务商与大模型 (BYOK)
* 敏感 API 密钥绝不泄露给客户端浏览器
* 完美兼容静态托管环境
* 无需搭建、运维任何 AI 后端服务
* 提供用量监控与读者提问热点分析
* 单个账户即可集中连接与管理多个文档项目

**[配置 Cloud Relay →](https://cloud.docmd.io)** • [AI 助手配置文档 →](https://docs.docmd.io/guides/ai/ai-assistant/)

> Cloud Relay 本身完全免费。模型推理用量由您选择的 AI 服务商单独计费。

## 命令行 (CLI)

```bash
docmd dev            # 启动本地开发服务器
docmd build          # 构建生产部署静态文件
docmd live           # 启动基于浏览器的在线编辑器
docmd init           # 生成配置文件
docmd doctor         # 检查配置与插件状态
docmd validate       # 校验文档内部链接
docmd migrate        # 从 Docusaurus、VitePress、MkDocs 或 Starlight 迁移
docmd deploy         # 生成部署配置
docmd mcp            # 通过 stdio 运行 MCP 服务器
docmd add <name>     # 安装插件或主题模板
docmd stop           # 停止正在运行的 docmd 开发服务器
```

**查看完整的 [命令行指令列表 →](https://docs.docmd.io/reference/cli-commands/)**

## 插件生态

docmd 基于灵活强劲的插件系统构建。常见的基础文档功能已随核心包直接提供，您亦可根据需求自由安装可选插件。

| 插件名称    |   状态   | 功能描述                                                             |
| :---------- | :------: | :------------------------------------------------------------------- |
| `ai`        |   核心   | RAG 强力的 AI 助手，支持 BYOK、本地模型及 Cloud Relay                |
| `search`    |   核心   | 离线关键词搜索，支持可选的语义检索                                   |
| `seo`       |   核心   | SEO 元数据与 Open Graph 标签                                         |
| `sitemap`   |   核心   | 自动生成 `sitemap.xml`                                               |
| `git`       |   核心   | Git 历史记录与页面最后更新时间元数据                                 |
| `analytics` |   核心   | 轻量无追踪访问统计集成                                               |
| `llms`      |   核心   | 自动生成 `llms.txt` 和 `llms-full.txt`                               |
| `okf`       |   核心   | Open Knowledge Format 结构化知识包                                   |
| `mermaid`   |   核心   | Mermaid 流程图与图表渲染                                             |
| `openapi`   |   核心   | OpenAPI 3.x 接口文档渲染器                                           |
| `pwa`       |   可选   | Progressive Web App 与离线浏览支持                                   |
| `threads`   |   可选   | 行内文档评论与讨论组 *(由 @svallory 贡献)*                           |
| `math`      |   可选   | KaTeX / LaTeX 数学公式渲染                                           |

安装可选插件：

```bash
docmd add <plugin-name>
```

**开发您自己的插件：[插件开发指南 →](https://docs.docmd.io/development/building-plugins/)**

## 配置文件

配置文件是可选的。

仅在需要更多精细控制时，才在项目根目录下添加 `docmd.config.json`、`docmd.config.ts` 或 `docmd.config.js`：

```json
{
  "title": "我的项目文档",
  "url": "https://docs.myproject.com",
  "src": "./docs",
  "out": "./dist"
}
```

当需要动态值时，可以使用 TypeScript 和 JavaScript 配置文件。

**[配置参考手册 →](https://docs.docmd.io/configuration/overview)**

## Node.js 编程接口 (API)

在 Node.js 脚本、CI 流水线或自定义构建系统中直接调用 docmd。

```javascript
import { build } from '@docmd/core';

// 通过代码调用构建文档
await build('./docmd.config.json', { isDev: false });
```

同时支持 CommonJS 与 ESM。

**[Node API 参考手册 →](https://docs.docmd.io/development/node-api-reference/)**

## 平滑迁移

现有的文档无需推倒重来。

```bash
docmd migrate
```

针对主流文档框架（包括 Docusaurus、VitePress、MkDocs 和 Starlight）提供专属迁移工具支持。

**[查看迁移文档 →](https://docs.docmd.io)**

## 开源承诺

文档是项目的智慧核心。它应该以纯净的 Markdown 文件保存在您的 Git 仓库中 — 便携、受版本控制且清晰可审计。

**docmd 编译器及官方核心插件均遵循 MIT 开源许可协议，并将永久免费提供，绝不设置任何付费墙或商业版编译器功能。**

构建生成的文档站点可以自由部署在任何服务器或托管平台上，无需依赖 docmd 托管的基础设施。

## 社区与交流

* **官方文档** → [docs.docmd.io](https://docs.docmd.io)
* **提问与想法交流** → [GitHub Discussions](https://github.com/orgs/docmd-io/discussions)
* **Bug 反馈与功能建议** → [GitHub Issues](https://github.com/docmd-io/docmd/issues)
* **参与贡献** → [CONTRIBUTING.md](.github/CONTRIBUTING.md)
* **路线图规划** → [GitHub Discussions](https://github.com/orgs/docmd-io/discussions/2)

## 支持 docmd

如果 docmd 对您有所帮助：

* 为本仓库点亮一颗 ⭐
* 将它分享给身边正在编写文档的朋友或团队
* 提交 Issue、贡献代码修复或开发专属插件
* [在 GitHub 上赞助支持开发者](https://github.com/sponsors/mgks)

## 开源协议

遵循 MIT 开源许可协议。详情请参阅 [LICENSE](LICENSE)。