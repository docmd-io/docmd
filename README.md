<div align="right">
  <sup>
    <b>EN</b> &nbsp;|&nbsp; <a href="./README.de.md">DE</a> &nbsp;|&nbsp; <a href="./README.zh.md">中文</a> &nbsp;|&nbsp; <a href="./README.es.md">ES</a> &nbsp;|&nbsp; <a href="./README.ja.md">日本語</a> &nbsp;|&nbsp; <a href="./README.fr.md">FR</a> &nbsp;|&nbsp; <a href="./README.ru.md">RU</a>
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

  <p><b>Documentation for humans and machines.</b><br/>One Markdown source → website, search, AI context, and agent protocols. All generated together.</p>

  <p>
    <a href="https://www.npmjs.com/package/@docmd/core"><img src="https://img.shields.io/npm/v/@docmd/core.svg?style=flat-square&color=CB3837" alt="npm version"></a>
    <a href="https://www.npmjs.com/package/@docmd/core?activeTab=versions"><img src="https://img.shields.io/npm/dm/@docmd/core.svg?style=flat-square&color=38bd24" alt="monthly downloads"></a>
    <a href="https://github.com/docmd-io/docmd"><img src="https://img.shields.io/github/stars/docmd-io/docmd?style=flat-square&logo=github" alt="GitHub stars"></a>
    <a href="https://github.com/docmd-io/docmd/blob/main/LICENSE"><img src="https://img.shields.io/github/license/docmd-io/docmd.svg?style=flat-square&color=A31F34" alt="license"></a>
  </p>

  <h4>
    <a href="https://docmd.io">Website</a> &nbsp;·&nbsp;
    <a href="https://docs.docmd.io">Documentation</a> &nbsp;·&nbsp;
    <a href="https://cloud.docmd.io">AI Cloud Relay</a> &nbsp;·&nbsp;
    <a href="https://live.docmd.io">Live Editor</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd-skills">Agent Skills</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd/issues">Report a Bug</a>
  </h4>

  <br/>

  <a href="https://docs.docmd.io">
    <img width="820" alt="docmd default theme — light and dark mode preview" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-cover.webp" />
  </a>

  <br/><br/>

</div>

> ## ✦ 0.9 Series — Documentation for Humans and Machines
>
> docmd compiles your Markdown into everything the modern stack needs —
> a fast static website for human readers, search indexes, AI context
> files (`llms.txt`), MCP server endpoints for coding agents, and
> structured knowledge bundles (OKF) for RAG pipelines.
>
> One source. One build. Every output.
>
> [Follow the 0.9 roadmap →](https://github.com/orgs/docmd-io/discussions/10)

## Quick Start

Run docmd in any folder with Markdown files — no install needed:

```bash
npx @docmd/core dev
```

<details>
  <summary><b>Opens at <code>http://localhost:3000</code></b></summary><br>

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

Navigation is generated from your file structure. No config file, no frontmatter required, no framework to learn.

**When you're ready to ship:**

```bash
npx @docmd/core build
```

This outputs a highly optimized static site (SPA) ready for deployment to Vercel, Cloudflare Pages, Netlify, GitHub Pages, or any static host.

**Requirements:** Node.js 18+

<details>
  <summary><b>Or install globally / via Docker</b></summary><br/>

```bash
# Install globally via npm
npm install -g @docmd/core

# Or via pnpm
pnpm add -g @docmd/core

# Run it
docmd dev    # start dev server
docmd build  # build for deployment
```

Or run via Docker:

```bash
docker run -p 3000:3000 ghcr.io/docmd-io/docmd:0.9.0
```

> Pin a version for reproducible builds.

</details>

## Why docmd?

Other documentation tools build a website. docmd builds **an entire knowledge ecosystem**:

```
Markdown source
     │
     ▼  docmd
     │
     ├──→  Static website       (for browsers and readers)
     ├──→  Search index         (offline full-text, no cloud needed)
     ├──→  llms.txt             (for LLMs and chatbots)
     ├──→  OKF bundles          (for RAG pipelines and knowledge systems)
     ├──→  Sitemap + SEO meta   (for search engines)
     ├──→  robots.txt + OG tags (for crawlers and social cards)
     ├──→  MCP server           (for IDE agents like Cursor, Claude Code)
     └──→  Cloud Relay          (hosted AI search for static sites)
```

One source, one command. No other documentation tool generates all of these together.

<div align="center">
  <img width="1000" alt="image" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-comparison.webp" />
</div>

**See Complete [Comparison with Docusaurus, Mintlify and others →](https://docs.docmd.io/comparison/)"

## Features

### Zero config, instant start
Point docmd at any Markdown folder and it runs. Navigation is built automatically from your file structure. You can write your first doc and have it live in under a minute — no boilerplate, no build pipeline to configure, no decisions to make upfront.

### Lightweight by default, fast everywhere
No framework runtime — the output is static HTML and minimal vanilla JavaScript. Pages navigate as an instant SPA. SEO-optimised, with sitemap, canonical URLs, and Open Graph metadata included. Offline full-text search is built in, no cloud service required.

### AI-native
docmd treats AI as a first-class way to consume documentation — without replacing the documentation itself.
- **AI Assistant (`@docmd/plugin-ai`)** — RAG-powered chat grounded in your documentation. Use your own API key or connect a local AI provider, with support for a wide range of 100+ providers through AIPlug.
- **Cloud Relay** — enable the AI Assistant on static documentation without running your own AI backend. [Try it →](https://cloud.docmd.io)
- **MCP Server** — `docmd mcp` exposes your docs to AI agents over stdio, letting them search, read, and validate content directly.
- **Context (`llms.txt` / `llms-full.txt`)** — complete documentation context generated at build time.
- **Agent Skills** — modular instruction sets for LLMs and IDE agents.
- **Open Knowledge Format (OKF)** — structured, multi-locale knowledge bundles for AI systems.
- **Copy as Markdown / Copy Context** — one-click context extraction directly from the browser.

### Built to scale
- Internationalisation with multi-locale builds (per-locale search index, llms, okf, hreflang)
- Versioning for multiple doc releases (with auto-detection of the current version)
- Workspaces for monorepos and multi-project setups
- Plugin system for extending core behaviour (per-hook return-type validation, async-friendly)
- Full theming support, built-in templates, custom CSS/JS, light/dark mode

## CLI

```bash
docmd dev            # local development server
docmd build          # build for deployment
docmd live           # browser-based Live Editor
docmd init           # scaffold a new docmd.config.json in the current folder
docmd stop           # stop any running `docmd dev` / `docmd live` servers
docmd doctor         # pre-flight check: config + plugin install status
docmd migrate        # migrate to docmd from Docusaurus, VitePress, MkDocs, or Starlight
docmd deploy         # generate config for Docker, NGINX, Caddy, Vercel, Netlify
docmd validate       # check all internal links
docmd mcp            # run as an MCP server over stdio
docmd add <name>     # install a plugin or template
```

## Plugins

Core functionality is powered by a robust plugin system. The essentials are included by default, while optional plugins can be added for specific needs.

| Plugin | Status | Description |
| :--- | :---: | :--- |
| `ai` | Core | RAG-powered AI Assistant with BYOK, local providers, and Cloud Relay |
| `search` | Core | Offline full-text search (keyword + optional semantic via `docmd-search`) |
| `seo` | Core | SEO tags and Open Graph metadata |
| `sitemap` | Core | Generates `sitemap.xml` |
| `git` | Core | Git commit history and last-updated dates |
| `analytics` | Core | Lightweight analytics integration |
| `llms` | Core | AI context generation (`llms.txt` / `llms-full.txt`) |
| `okf` | Core | Open Knowledge Format bundles for AI agents (per-locale) |
| `mermaid` | Core | Mermaid diagram support |
| `openapi` | Core | Build-time OpenAPI 3.x spec renderer |
| `pwa` | Optional | Progressive Web App — offline navigation |
| `threads` | Optional | Inline discussion threads *(by @svallory)* |
| `math` | Optional | KaTeX / LaTeX math rendering |

Install optional plugins:

```bash
docmd add <plugin-name>
```

Build your own: [Plugin Development Guide](https://docs.docmd.io/development/building-plugins/)

## Configuration

No configuration is required to get started. Add a `docmd.config.json` (or `.ts` / `.js`) in your project root only when you need more control:

```json
{
  "title": "My Project",
  "url": "https://docs.myproject.com",
  "src": "./docs",
  "out": "./dist"
}
```

TypeScript and JavaScript config files are supported for dynamic values.

Full reference: [Configuration Overview](https://docs.docmd.io/configuration/overview)

## Project Structure

```text
my-docs/
├── docs/                ← Your markdown files
├── assets/              ← Images and static files
├── docmd.config.json    ← Optional configuration
└── package.json
```

## Live Editor

A browser-based editor for writing and previewing docs — no local setup required.

**Try it at [live.docmd.io](https://live.docmd.io)**

## Programmatic API

Use docmd in Node.js scripts, CI pipelines, or custom build steps. (Supports both CommonJS and ESM).

```javascript
import { build } from '@docmd/core';

await build('./docmd.config.json', { isDev: false });
```

Full reference: [Node API](https://docs.docmd.io/development/node-api-reference/)

## Community

- **Bugs & issues** → [GitHub Issues](https://github.com/docmd-io/docmd/issues)
- **Questions & ideas** → [Discussions](https://github.com/orgs/docmd-io/discussions)
- **Contributing** → [CONTRIBUTING.md](.github/CONTRIBUTING.md)
- **Roadmap** → [GitHub Discussions](https://github.com/orgs/docmd-io/discussions/2)

## Support

- Getting the word out is the most direct way to support docmd's development. [Share it on X](https://twitter.com/intent/tweet?url=https://github.com/docmd-io/docmd&text=docmd%20-%20Documentation%20for%20humans%20and%20machines.) with friends or give it a star.
- If docmd saves you time, a [GitHub sponsorship](https://github.com/sponsors/mgks) goes a long way.
- Got ideas or bugs? Open an issue or PR, feel free to contribute your own plugins.

## License

MIT License. See `LICENSE` for details.