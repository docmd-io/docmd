<div align="right">
  <sup>
    <b>EN</b> &nbsp;|&nbsp; <a href="./README.de.md">DE</a> &nbsp;|&nbsp; <a href="./README.zh.md">中文</a> &nbsp;|&nbsp; <a href="./README.es.md">ES</a> &nbsp;|&nbsp; <a href="./README.ja.md">日本語</a> &nbsp;|&nbsp; <a href="./README.fr.md">FR</a> &nbsp;|&nbsp; <a href="./README.ru.md">RU</a> &nbsp;|&nbsp; <a href="./README.tr.md">TR</a>
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
    <b>Documentation for humans and machines.</b><br/>
    One Markdown source → website, search, AI context, agents, and knowledge formats.
  </p>

  <p>
    <a href="https://www.npmjs.com/package/@docmd/core"><img src="https://img.shields.io/npm/v/@docmd/core.svg?style=flat-square&color=CB3837" alt="npm version"></a>
    <a href="https://www.npmjs.com/package/@docmd/core?activeTab=versions"><img src="https://img.shields.io/npm/dm/@docmd/core.svg?style=flat-square&color=38bd24" alt="monthly downloads"></a>
    <a href="https://github.com/docmd-io/docmd"><img src="https://img.shields.io/github/stars/docmd-io/docmd?style=flat-square&logo=github" alt="GitHub stars"></a>
    <a href="https://github.com/docmd-io/docmd/blob/main/LICENSE"><img src="https://img.shields.io/github/license/docmd-io/docmd.svg?style=flat-square&color=A31F34" alt="license"></a>
  </p>

  <h4>
    <a href="https://docmd.io">Website</a> &nbsp;·&nbsp;
    <a href="https://docs.docmd.io">Documentation</a> &nbsp;·&nbsp;
    <a href="https://cloud.docmd.io">Cloud Relay</a> &nbsp;·&nbsp;
    <a href="https://live.docmd.io">Live Editor</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd-skills">Agent Skills</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd/issues">Issues</a>
  </h4>

  <br/>

  <a href="https://docmd.io">
    <img width="820" alt="docmd documentation — light and dark mode preview" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-cover.webp" />
  </a>

</div>

## Quick Start

Point docmd at a folder of Markdown files:

```bash
npx @docmd/core dev
```

Open `http://localhost:3000`.

That's it. Navigation is generated from your file structure. No config file, frontmatter, or framework required.

When you're ready to deploy:

```bash
npx @docmd/core build
```

docmd generates a static site that can be deployed to Vercel, Cloudflare Pages, Netlify, GitHub Pages, S3, NGINX, Caddy, or any other static host.

**Requires Node.js 20+.**

<details>
  <summary><b>Global installation and Docker</b></summary>

<br/>

Install globally:

```bash
npm install -g @docmd/core

# or
pnpm add -g @docmd/core
```

Then:

```bash
docmd dev
docmd build
```

Or run with Docker:

```bash
docker run -p 3000:3000 ghcr.io/docmd-io/docmd:latest
```

> Pin the Docker image to a specific release for reproducible production builds.

</details>

## One Source. Every Output.

docmd is an open source documentation compiler.

Instead of treating your Markdown as input for a website alone, docmd compiles the same source into outputs for readers, search engines, LLMs, coding agents, and knowledge systems.

```text
Markdown
   │
   ▼
 docmd
   │
   ├── → Static documentation site
   ├── → Offline search index
   ├── → llms.txt / llms-full.txt
   ├── → Open Knowledge Format (OKF)
   ├── → Sitemap + SEO metadata
   ├── → robots.txt + Open Graph
   ├── → MCP interface for AI agents
   └── → AI Assistant context
```

One source tree. One build pipeline. No separate documentation and AI knowledge stacks to maintain.

## Why docmd?

Documentation increasingly has more than one reader.

People need a fast, navigable website. Search engines need structured metadata. LLMs need clean context. Coding agents need tools and protocols. RAG systems need structured knowledge.

docmd builds these together while keeping Markdown at the centre.

<a href="https://docs.docmd.io/comparison/">
  <img width="800" alt="docmd comparison with other documentation tools" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-comparison.webp" />
</a>
<br/>
<b>See the complete comparison with <a href="https://docs.docmd.io/comparison/">Docusaurus, Mintlify and other documentation tools →</a></b>

## Features

### Zero config, instant start

Point docmd at any Markdown folder and it runs. Navigation is generated automatically from your file structure — no boilerplate, frontmatter, or build pipeline required to get started.

### Lightweight by default, fast everywhere

docmd generates static HTML with minimal vanilla JavaScript and fast SPA-style navigation. Offline full-text search, sitemap, canonical URLs, Open Graph metadata, and other essentials are built into the output.

### AI & agent-ready

docmd treats machine-readable documentation as part of the build, not a separate publishing workflow.

* **AI Assistant** — RAG-powered chat grounded in your documentation
* **MCP Server** — lets compatible coding agents search, read, and validate your docs
* **`llms.txt` / `llms-full.txt`** — complete LLM-readable documentation context
* **Open Knowledge Format (OKF)** — structured knowledge bundles for AI and RAG systems
* **Agent Skills** — reusable instructions for LLMs and coding agents
* **Copy as Markdown / Copy Context** — clean context extraction directly from the browser
* **Semantic search** — optional vector retrieval alongside built-in keyword search

### Built to scale

* Internationalisation with locale-aware search and generated outputs
* Versioning for multiple documentation releases
* Workspaces for monorepos and multi-project setups
* OpenAPI 3.x rendering for API documentation
* Built-in templates, custom CSS/JavaScript, and light/dark mode

## AI Assistant & Cloud Relay

docmd includes a RAG-powered AI Assistant grounded in your documentation.

You can connect it to your own backend or local AI provider. If your documentation is deployed as a static site, **docmd Cloud Relay** provides the hosted bridge instead.

```text
Your documentation
        │
        ▼
 @docmd/plugin-ai
        │
        ▼
 docmd Cloud Relay
        │
        ▼
 Your AI provider
```

Cloud Relay securely sends AI requests to the provider you choose, so provider credentials do not need to be shipped to the browser and you do not need to operate an AI backend.

**Cloud Relay is free to use with your own AI provider key.**

* Bring your own provider and model
* Keep provider credentials off the client
* Works with static hosting
* No AI backend to deploy or maintain
* Usage visibility and reader-question insights
* Connect multiple documentation projects from one account

**[Set up Cloud Relay →](https://cloud.docmd.io)** • [AI Assistant documentation →](https://docs.docmd.io/guides/ai/ai-assistant/)

> The Cloud Relay is free. Model usage may be charged separately by your chosen AI provider.

## CLI

```bash
docmd dev            # Start the local development server
docmd build          # Build for production
docmd live           # Start the browser-based Live Editor
docmd init           # Create a configuration file
docmd doctor         # Check configuration and plugin status
docmd validate       # Check internal documentation links
docmd migrate        # Migrate from Docusaurus, VitePress, MkDocs, or Starlight
docmd deploy         # Generate deployment configuration
docmd mcp            # Run the MCP server over stdio
docmd add <name>     # Install a plugin or template
docmd stop           # Stop running docmd development servers
```

**See complete [CLI Commands →](https://docs.docmd.io/reference/cli-commands/)**

## Plugins

docmd is built around a plugin system. Common documentation capabilities ship with core, while optional plugins can be installed when needed.

| Plugin      |  Status  | Description                                                          |
| :---------- | :------: | :------------------------------------------------------------------- |
| `ai`        |   Core   | RAG-powered AI Assistant with BYOK, local providers, and Cloud Relay |
| `search`    |   Core   | Offline keyword search with optional semantic search                 |
| `seo`       |   Core   | SEO and Open Graph metadata                                          |
| `sitemap`   |   Core   | Generates `sitemap.xml`                                              |
| `git`       |   Core   | Git history and last-updated metadata                                |
| `analytics` |   Core   | Lightweight analytics integration                                    |
| `llms`      |   Core   | Generates `llms.txt` and `llms-full.txt`                             |
| `okf`       |   Core   | Open Knowledge Format bundles                                        |
| `mermaid`   |   Core   | Mermaid diagram rendering                                            |
| `openapi`   |   Core   | OpenAPI 3.x documentation renderer                                   |
| `pwa`       | Optional | Progressive Web App and offline navigation                           |
| `threads`   | Optional | Inline documentation discussions *(by @svallory)*                    |
| `math`      | Optional | KaTeX / LaTeX rendering                                              |

Install an optional plugin:

```bash
docmd add <plugin-name>
```

**Build your own: [Plugin Development Guide →](https://docs.docmd.io/development/building-plugins/)**

## Configuration

Configuration is optional.

Add `docmd.config.json`, `docmd.config.ts`, or `docmd.config.js` in your project root when you need more control:

```json
{
  "title": "My Project",
  "url": "https://docs.myproject.com",
  "src": "./docs",
  "out": "./dist"
}
```

TypeScript and JavaScript configurations can be used when dynamic values are required.

**[Configuration reference →](https://docs.docmd.io/configuration/overview)**

## Programmatic API

Use docmd from Node.js scripts, CI pipelines, or custom build systems.

```javascript
import { build } from '@docmd/core';

// Build documentation programmatically.
await build('./docmd.config.json', { isDev: false });
```

CommonJS and ESM are supported.

**[Node API reference →](https://docs.docmd.io/development/node-api-reference/)**

## Migration

Existing documentation does not need to start from scratch.

```bash
docmd migrate
```

Migration tooling is available for supported documentation frameworks including Docusaurus, VitePress, MkDocs, and Starlight.

**[Migration documentation →](https://docs.docmd.io)**

## Open Source

Your documentation is the intellectual heart of your project. It belongs in plain Markdown files in your Git repository — portable, version-controlled and auditable.

**The docmd compiler and official core plugins are MIT-licensed and will remain free to use, with no paywalled compiler features.**

Generated documentation can be hosted anywhere and does not require docmd-hosted infrastructure.

## Community

* **Documentation** → [docs.docmd.io](https://docs.docmd.io)
* **Questions & ideas** → [GitHub Discussions](https://github.com/orgs/docmd-io/discussions)
* **Bugs & feature requests** → [GitHub Issues](https://github.com/docmd-io/docmd/issues)
* **Contributing** → [CONTRIBUTING.md](.github/CONTRIBUTING.md)
* **Roadmap** → [GitHub Discussions](https://github.com/orgs/docmd-io/discussions/2)

## Support docmd

If docmd is useful to you:

* Give the repository a ⭐
* Share it with someone building documentation
* Open issues, contribute fixes, or build a plugin
* [Sponsor development on GitHub](https://github.com/sponsors/mgks)

## License

MIT License. See [LICENSE](LICENSE) for details.