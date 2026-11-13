/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * @package     @docmd/core (and ecosystem)
 * @website     https://docmd.io
 * @repository  https://github.com/docmd-io/docmd
 * @license     MIT
 * @copyright   Copyright (c) 2025-present docmd.io
 *
 * [docmd-source] - Please do not remove this header.
 * --------------------------------------------------------------------
 */

import { TUI } from '@docmd/api';
import { fsUtils as fs } from '@docmd/utils';
import path from 'path';
import readline from 'readline';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json');

const defaultConfigContent = `{
  "title": "My Documentation",
  "url": "https://docs.myproject.com",
  "src": "docs",
  "out": "site",
  "engine": "js",
  "layout": {
    "spa": true,
    "header": {
      "enabled": true
    },
    "sidebar": {
      "collapsible": true,
      "defaultCollapsed": false
    },
    "optionsMenu": {
      "position": "sidebar-top",
      "components": {
        "search": true,
        "themeSwitch": true
      }
    },
    "footer": {
      "style": "minimal",
      "content": "© ${new Date().getFullYear()} My Project.",
      "branding": true
    }
  },
  "theme": {
    "name": "default",
    "appearance": "system",
    "codeHighlight": true
  },
  "minify": true,
  "autoTitleFromH1": true,
  "copyCode": true,
  "pageNavigation": true,
  "navigation": [
    { "title": "Quick Start", "path": "/", "icon": "zap" },
    { "title": "Agent Skills", "path": "/skills/", "icon": "brain-circuit" },
    {
      "title": "Quick Guide",
      "icon": "book-open",
      "collapsible": false,
      "children": [
        { "title": "Install", "path": "https://docs.docmd.io/getting-started/installation/", "icon": "download", "external": true },
        { "title": "Configure", "path": "https://docs.docmd.io/configuration/overview/", "icon": "settings", "external": true },
        { "title": "Migrate", "path": "https://docs.docmd.io/migration/overview/", "icon": "arrow-left-right", "external": true },
        { "title": "Deploy", "path": "https://docs.docmd.io/deployment/", "icon": "rocket", "external": true }
      ]
    },
    { "title": "GitHub", "path": "https://github.com/docmd-io/docmd", "icon": "github", "external": true }
  ],
  "plugins": {
    "ai": {
      "assistant": true,
      "projectId": ""
    },
    "git": {
      "commitHistory": true,
      "maxCommits": 5
    },
    "seo": {
      "defaultDescription": "Documentation built with docmd."
    }
  }
}
`;

const defaultIndexMdContent = `---
title: "Quick Start"
description: "Welcome to your new documentation site."
---

# Quick Start Your Docs 🚀

This is the home page of your new **docmd** project. You're currently viewing \`docs/index.md\` — edit it, and your site updates.

## Run the dev server

\`\`\`bash
npx @docmd/core dev
\`\`\`

Open \`http://127.0.0.1:3000\` — the page auto-reloads as you edit.

## Build for production

\`\`\`bash
npx @docmd/core build
\`\`\`

Output goes to \`site/\`. Deploy that folder anywhere that serves static files.

## Project structure

\`\`\`text
.
├── docs/                  # Your markdown content
│   └── index.md           # You are here
├── assets/                # Custom CSS, JS, and images
├── docmd.config.json      # Site configuration
└── package.json           # Node dependencies + scripts
\`\`\`

## Features

### 1. Smart containers

\`\`\`markdown
::: callout tip "Did you know?"
You can nest containers, add titles, and use icons.
:::

::: card "Flexible" icon:layout-grid
Organise content with cards.

[View the docs →](https://docs.docmd.io){.docmd-button}
:::
\`\`\`

Renders as a styled callout and a card with a button.

### 2. Tabs and code

\`\`\`\`markdown
::: tabs
== tab "JavaScript" icon:braces
\`\`\`javascript
console.log('Hello World');
\`\`\`

== tab "Python" icon:code
\`\`\`python
print('Hello World')
\`\`\`
:::
\`\`\`\`

### 3. Built-in plugins

docmd ships with these plugins enabled by default — no install needed:

- **AI Assistant** — interactive documentation chat (100% free with BYOK or docmd Cloud)
- **Search** — full-text + semantic search (optional)
- **Sitemap** + **SEO** meta tags
- **LLMs context** — \`llms.txt\` and \`llms.json\` for AI agents
- **OKF** — Open Knowledge Format bundle at \`site/okf/\`
- **Mermaid** diagrams
- **Git** last-modified timestamps
- **Math** (KaTeX) — enable with \`docmd add math\`

See the [full plugin list](https://docs.docmd.io/plugins/usage/).

## Next steps

- **[Install docmd](https://docs.docmd.io/getting-started/installation/)**
- **[Configure your site](https://docs.docmd.io/configuration/overview/)**
- **[Browse templates](https://docs.docmd.io/theming/templates/)**
- **[Deploy to production](https://docs.docmd.io/deployment/)**
- **[GitHub repo](https://github.com/docmd-io/docmd/)**

Happy documenting! 🎉`;

const defaultSkillsMdContent = `---
title: "Agent Skills"
description: "Teach AI coding agents to work with docmd projects"
---

# Agent Skills

docmd ships a **modular skill set** for AI coding agents (Claude Code, Cursor, Windsurf, Copilot, etc.). The skills teach your agent the \`docmd\` CLI, configuration, plugin system, and the \`docmd mcp\` server — so it can build, configure, validate, and deploy sites for you.

## What gets installed

The [\`docmd-skills\`](https://www.npmjs.com/package/docmd-skills) npm package contains three skill modules:

| Skill | When your agent loads it |
|---|---|
| **\`docmd-skills\`** | A docmd **site operator**. Knows the \`npx @docmd/core\` CLI, \`docmd.config.json\`, plugins, themes, deployment, and the \`docmd mcp\` server. |
| **\`docmd-dev\`** | A docmd **framework contributor**. Knows the monorepo layout, how to author plugins and templates, the JS / Rust engine loaders, and the public Node API (\`EngineLoader\`, \`createActionDispatcher\`, \`TemplateSlot\`). |
| **\`docmd-writer\`** | A **multi-language documentation writer**. Drafts and reviews prose in any language, with SEO awareness and docmd's markdown conventions (containers, frontmatter, file-title rule). |

## Install

Pick the directory your agent reads skills from and run **one** command:

### Claude Code

\`\`\`bash
npx docmd-skills ~/.claude/skills
\`\`\`

### Cursor

\`\`\`bash
npx docmd-skills ~/.cursor/skills
\`\`\`

### Project-local (any agent)

\`\`\`bash
npx docmd-skills ./.skills
\`\`\`

After install, the \`docmd-skills\`, \`docmd-dev\`, and \`docmd-writer\` modules are available to your agent.

Run \`npx docmd-skills --help\` for the full list of commands.

## How it works at runtime

Once installed, your agent automatically loads the right skill based on the files in scope:

- When you ask "add a plugin to my docmd site" → \`docmd-skills\` loads
- When you ask "add a new template" inside the cloned \`docmd-io/docmd\` monorepo → \`docmd-dev\` loads
- When you ask "write the intro for my new docs" → \`docmd-writer\` loads

## Update or remove

The CLI is idempotent — running it again updates the skills to latest:

\`\`\`bash
npx docmd-skills <dir>          # updates all three
npx docmd-skills remove <dir>   # deletes all three
\`\`\`
`;

const defaultPackageJson = {
  name: "my-docs",
  version: "0.0.1",
  private: true,
  type: "module",
  scripts: {
    "dev": "docmd dev",
    "build": "docmd build",
    "preview": "npx serve site"
  },
  dependencies: {
    "@docmd/core": `^${version}`
  }
};

export async function initProject(opts: { force?: boolean; yes?: boolean } = {}) {
  const baseDir = process.cwd();
  const packageJsonFile = path.join(baseDir, 'package.json');
  const configFile = path.join(baseDir, 'docmd.config.json');
  const docsDir = path.join(baseDir, 'docs');
  const indexMdFile = path.join(docsDir, 'index.md');
  const skillsMdFile = path.join(docsDir, 'skills.md');
  const skillFile = path.join(baseDir, 'SKILL.md');
  const assetsDir = path.join(baseDir, 'assets');
  const assetsCssDir = path.join(assetsDir, 'css');
  const assetsJsDir = path.join(assetsDir, 'js');
  const assetsImagesDir = path.join(assetsDir, 'images');

  const existingFiles = [];
  const dirExists = {
    docs: false,
    assets: false
  };

  TUI.section('Project Setup');

  // Check if package.json exists
  if (!await fs.pathExists(packageJsonFile)) {
    await fs.writeJson(packageJsonFile, defaultPackageJson, { spaces: 2 });
    TUI.step('Created package.json', 'DONE');
  } else {
    TUI.step('Using existing package.json', 'SKIP');
  }

  // Check each configuration file variant individually
  if (await fs.pathExists(configFile)) {
    existingFiles.push('docmd.config.json');
  }
  const jsConfigFile = path.join(baseDir, 'docmd.config.js');
  if (await fs.pathExists(jsConfigFile)) {
    existingFiles.push('docmd.config.js');
  }
  const tsConfigFile = path.join(baseDir, 'docmd.config.ts');
  if (await fs.pathExists(tsConfigFile)) {
    existingFiles.push('docmd.config.ts');
  }

  // Check for the legacy config.js
  const oldConfigFile = path.join(baseDir, 'config.js');
  if (await fs.pathExists(oldConfigFile)) {
    existingFiles.push('config.js');
  }

  // Check if docs directory exists
  if (await fs.pathExists(docsDir)) {
    dirExists.docs = true;
    if (await fs.pathExists(indexMdFile)) {
      existingFiles.push('docs/index.md');
    }
    if (await fs.pathExists(skillsMdFile)) {
      existingFiles.push('docs/skills.md');
    }
  }

  // Check if assets directory exists
  if (await fs.pathExists(assetsDir)) {
    dirExists.assets = true;
  }

  // Determine if we should override existing files
  let shouldOverride = !!opts.force;
  if (existingFiles.length > 0 && !shouldOverride) {
    TUI.warn('Existing files detected:');
    existingFiles.forEach(file => TUI.item('', file));

    // In a non-interactive environment (CI, piped input, Docker without -it,
    // npx with no TTY), skip the prompt. Default to "no" for safety unless
    // --yes is passed.
    const isInteractive = !!process.stdin.isTTY;
    if (!isInteractive) {
      if (opts.yes) {
        shouldOverride = true;
        TUI.dim('  (non-interactive mode + --yes: overriding existing files)');
      } else {
        shouldOverride = false;
        TUI.dim('  (non-interactive mode: keeping existing files. Pass --force to override.)');
      }
    } else {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise(resolve => {
        rl.question(`\n ${TUI.bold('Do you want to override these files?')} (y/N): `, resolve);
      });

      rl.close();

      shouldOverride = (answer as string).toLowerCase() === 'y';
    }

    if (!shouldOverride) {
      TUI.step('Maintaining existing files', 'SKIP');
    }
  } else if (existingFiles.length > 0 && shouldOverride) {
    TUI.warn(`Overriding ${existingFiles.length} existing file(s) (--force)`);
  }

  // Create docs directory if it doesn't exist
  if (!dirExists.docs) {
    await fs.ensureDir(docsDir);
    TUI.step('Created docs/ directory', 'DONE');
  } else {
    TUI.step('Using existing docs/ directory', 'SKIP');
  }

  // Create assets directory structure if it doesn't exist
  if (!dirExists.assets) {
    await fs.ensureDir(assetsDir);
    await fs.ensureDir(assetsCssDir);
    await fs.ensureDir(assetsJsDir);
    await fs.ensureDir(assetsImagesDir);
    TUI.step('Created assets/ infrastructure', 'DONE');
  } else {
    TUI.step('Using existing assets/ directory', 'SKIP');
    if (!await fs.pathExists(assetsCssDir)) await fs.ensureDir(assetsCssDir);
    if (!await fs.pathExists(assetsJsDir)) await fs.ensureDir(assetsJsDir);
    if (!await fs.pathExists(assetsImagesDir)) await fs.ensureDir(assetsImagesDir);
  }

  // Write config file if it doesn't exist or user confirmed override
  if (!await fs.pathExists(configFile) && !await fs.pathExists(jsConfigFile) && !await fs.pathExists(tsConfigFile) || shouldOverride) {
    await fs.writeFile(configFile, defaultConfigContent, 'utf8');
    TUI.step(`${shouldOverride ? 'Updated' : 'Created'} docmd.config.json`, 'DONE');
  } else {
    TUI.step('Using existing configuration', 'SKIP');
  }

  // Write index.md file if it doesn't exist or user confirmed override
  if (!await fs.pathExists(indexMdFile)) {
    await fs.writeFile(indexMdFile, defaultIndexMdContent, 'utf8');
    TUI.step('Created docs/index.md', 'DONE');
  } else if (shouldOverride) {
    await fs.writeFile(indexMdFile, defaultIndexMdContent, 'utf8');
    TUI.step('Updated docs/index.md', 'DONE');
  } else {
    TUI.step('Using existing docs/index.md', 'SKIP');
  }

  // Write skills.md (the Agent Skills docs page) if it doesn't exist or user confirmed override
  if (!await fs.pathExists(skillsMdFile)) {
    await fs.writeFile(skillsMdFile, defaultSkillsMdContent, 'utf8');
    TUI.step('Created docs/skills.md', 'DONE');
  } else if (shouldOverride) {
    await fs.writeFile(skillsMdFile, defaultSkillsMdContent, 'utf8');
    TUI.step('Updated docs/skills.md', 'DONE');
  } else {
    TUI.step('Using existing docs/skills.md', 'SKIP');
  }

  // Write SKILL.md if it doesn't exist or user confirmed override
  if (!await fs.pathExists(skillFile) || shouldOverride) {
    TUI.dim('  Run `npx docmd-skills <dir>` to install the full agent skill set.');
  } else {
    TUI.step('Using existing SKILL.md', 'SKIP');
  }

  TUI.footer();
  TUI.success('Initialisation complete. Run `npm install` to setup dependencies.');
}