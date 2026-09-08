<div align="right">
  <sup>
    <a href="./README.md">EN</a> &nbsp;|&nbsp; <b>DE</b> &nbsp;|&nbsp; <a href="./README.zh.md">中文</a> &nbsp;|&nbsp; <a href="./README.es.md">ES</a> &nbsp;|&nbsp; <a href="./README.ja.md">日本語</a> &nbsp;|&nbsp; <a href="./README.fr.md">FR</a> &nbsp;|&nbsp; <a href="./README.ru.md">RU</a>
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

  <p><b>Dokumentation für Menschen und Maschinen.</b><br/>Eine Markdown-Quelle → Website, Suche, KI-Kontext und Agent-Protokolle. Alles in einem Build.</p>

  <p>
    <a href="https://www.npmjs.com/package/@docmd/core"><img src="https://img.shields.io/npm/v/@docmd/core.svg?style=flat-square&color=CB3837" alt="npm version"></a>
    <a href="https://www.npmjs.com/package/@docmd/core?activeTab=versions"><img src="https://img.shields.io/npm/dm/@docmd/core.svg?style=flat-square&color=38bd24" alt="monatliche Downloads"></a>
    <a href="https://github.com/docmd-io/docmd"><img src="https://img.shields.io/github/stars/docmd-io/docmd?style=flat-square&logo=github" alt="GitHub-Sterne"></a>
    <a href="https://github.com/docmd-io/docmd/blob/main/LICENSE"><img src="https://img.shields.io/github/license/docmd-io/docmd.svg?style=flat-square&color=A31F34" alt="Lizenz"></a>
  </p>

  <h4>
    <a href="https://docmd.io">Website</a> &nbsp;·&nbsp;
    <a href="https://docs.docmd.io/de/">Dokumentation</a> &nbsp;·&nbsp;
    <a href="https://cloud.docmd.io">AI Cloud Relay</a> &nbsp;·&nbsp;
    <a href="https://live.docmd.io">Live-Editor</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd-skills">Agent Skills</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd/issues">Bug melden</a>
  </h4>

  <br/>

  <a href="https://docs.docmd.io/de/">
    <img width="820" alt="docmd Standard-Theme — Vorschau Light- und Dark-Mode" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-cover.webp" />
  </a>

  <br/><br/>

</div>

> ## ✦ 0.9 Serie — KI, Automatisierung & Sicherheit
>
> In der 0.9.x-Serie erweitert sich docmd von einem KI-bereiten Dokumentationsgenerator
> zu einer Dokumentationsplattform, die sowohl für **Menschen als auch für KI-Agenten**
> entwickelt wurde.
>
> Die Serie führt den **KI-Assistenten** ein, mit dem Dokumentationen dialogbasiert
> über Ihren eigenen Anbieter, lokale KI oder den **docmd Cloud Relay** für statische
> Websites ohne eigenes Backend abgefragt werden können. Zudem wird das KI-Ökosystem
> von docmd um MCP, generierten LLM-Kontext, Agent Skills und strukturierte Wissensformate erweitert.
>
> Neben KI konzentriert sich diese Serie auf **Sicherheit, Datenschutz und Automatisierung**,
> während die Kernfunktionen für Dokumentation, Suche, Deployment und Entwickler-Workflows
> kontinuierlich verbessert werden.
>
> [Der 0.9 Roadmap folgen →](https://github.com/orgs/docmd-io/discussions/10)

## Schnellstart

Starten Sie docmd in jedem Ordner mit Markdown-Dateien — keine Installation nötig:

```bash
npx @docmd/core dev
```

<details>
  <summary><b>Öffnet unter <code>http://localhost:3000</code></b></summary><br>

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

Die Navigation wird aus Ihrer Verzeichnisstruktur generiert. Keine Config-Datei, kein Frontmatter nötig, kein Framework zu lernen.

**Wenn Sie bereit zum Veröffentlichen sind:**

```bash
npx @docmd/core build
```

Dies erzeugt eine hochoptimierte statische Site (SPA), bereit für das Deployment zu Vercel, Cloudflare Pages, Netlify, GitHub Pages oder jedem beliebigen Static Host.

**Anforderungen:** Node.js 18+

<details>
  <summary><b>Oder global installieren / per Docker</b></summary><br/>

```bash
# Global via npm installieren
npm install -g @docmd/core

# Oder via pnpm
pnpm add -g @docmd/core

# Ausführen
docmd dev    # Dev-Server starten
docmd build  # Für Deployment bauen
```

Oder per Docker:

```bash
docker run -p 3000:3000 ghcr.io/docmd-io/docmd:0.9.0
```

> Versionieren Sie für reproduzierbare Builds.

</details>

## Warum docmd?

<div align="center">
  <img width="1000" alt="image" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-comparison.webp" />
</div>

<!--
| Feature | docmd | Docusaurus | MkDocs | VitePress | Mintlify |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Config erforderlich** | **Keine** | `docusaurus.config.js` | `mkdocs.yml` | `config.mts` | `docs.json` |
| **JS-Payload** | **~18 kb** | ~250 kb | ~40 kb | ~50 kb | ~120 kb |
| **Navigation** | **Sofortige SPA** | React SPA | Vollständiger Reload | Vue SPA | Gehostete SPA |
| **Versionierung** | **Nativ** | Nativ (komplex) | mike-Plugin | Manuell | Nativ |
| **i18n** | **Nativ** | Nativ (komplex) | Plugin-basiert | Nativ | Nativ |
| **Multi-Projekt** | **Nativ** | Plugin | Plugin | - | - |
| **Suche** | **Eingebaut** | Algolia (Cloud) | Eingebaut | MiniSearch | Cloud |
| **KI-Assistent** | **Eingebaut — BYOK + Cloud Relay** | - | - | - | Eingebaut (Cloud) |
| **AI-Kontext (`llms.txt`)** | **Eingebaut** | - | - | - | Eingebaut |
| **MCP-Server** | **Eingebaut** | - | - | - | Eingebaut |
| **Agent Skills** | **Eingebaut** | - | - | - | - |
| **Docker-Image** | **Offiziell** | - | Offiziell | - | - |
| **Self-hosted** | **Ja** | Ja | Ja | Ja | - |
| **Kosten** | **Frei (OSS)** | Frei (OSS) | Frei (OSS) | Frei (OSS) | Freemium |
-->

**Vollständiger [Vergleich mit Docusaurus, Mintlify und weiteren →](https://docs.docmd.io/de/comparison/)**

## Features

### Zero Config, sofortiger Start
Zeigen Sie docmd auf einen beliebigen Markdown-Ordner und es läuft. Die Navigation wird automatisch aus Ihrer Verzeichnisstruktur erstellt. Sie können Ihre erste Doku schreiben und in unter einer Minute live haben — kein Boilerplate, keine zu konfigurierende Build-Pipeline, keine Vorab-Entscheidungen.

### Leichtgewichtig von Haus aus, schnell überall
Kein Framework-Runtime — die Ausgabe ist statisches HTML und minimales Vanilla-JavaScript. Seiten navigieren als sofortige SPA. SEO-optimiert, mit Sitemap, kanonischen URLs und Open-Graph-Metadaten. Offline-Volltextsuche ist eingebaut, kein Cloud-Dienst nötig.

### AI-nativ
docmd behandelt KI als erstklassige Möglichkeit, Dokumentationen zu konsumieren — ohne die Dokumentation selbst zu ersetzen.
- **KI-Assistent (`@docmd/plugin-ai`)** — RAG-gestützter Chat, basierend auf Ihrer Dokumentation. Nutzen Sie Ihren eigenen API-Schlüssel oder verbinden Sie einen lokalen KI-Anbieter, mit Unterstützung für über 100 Anbieter via AIPlug.
- **Cloud Relay** — aktivieren Sie den KI-Assistenten auf statischen Dokumentationen ohne eigenen KI-Backend-Betrieb. [Ausprobieren →](https://cloud.docmd.io)
- **MCP-Server** — `docmd mcp` stellt Ihre Doku KI-Agenten über stdio zur Verfügung, damit diese direkt suchen, lesen und Inhalte validieren können.
- **Kontext (`llms.txt` / `llms-full.txt`)** — vollständiger Dokumentations-Kontext, zur Build-Zeit generiert.
- **Agent Skills** — modulare Anleitungs-Sets für LLMs und IDE-Agenten.
- **Open Knowledge Format (OKF)** — strukturierte, mehrsprachige Wissenspakete für KI-Systeme.
- **Als Markdown kopieren / Kontext kopieren** — Ein-Klick-Kontextextraktion direkt im Browser.

### Auf Skalierung ausgelegt
- Internationalisierung mit Multi-Locale-Builds (Suchindex pro Sprachversion, llms, okf, hreflang)
- Versionierung für mehrere Dokumentations-Releases (mit automatischer Erkennung der aktuellen Version)
- Workspaces für Monorepos und Multi-Projekt-Setups
- Plugin-System zur Erweiterung der Kern-Funktionalität (Rückgabetyp-Validierung pro Hook, async-freundlich)
- Volle Theming-Unterstützung, eingebaute Templates, eigenes CSS/JS, Light/Dark-Mode

## CLI

```bash
docmd dev            # lokaler Dev-Server
docmd build          # Für Deployment bauen
docmd live           # Browser-basierter Live-Editor
docmd init           # neue docmd.config.json im aktuellen Ordner anlegen
docmd stop           # laufende `docmd dev` / `docmd live` Server stoppen
docmd doctor         # Vorab-Check: Konfiguration + Plugin-Installationsstatus
docmd migrate        # Import aus Docusaurus, VitePress, MkDocs oder Starlight
docmd deploy         # Config für Docker, NGINX, Caddy, Vercel, Netlify generieren
docmd validate       # Alle internen Links prüfen
docmd mcp            # Als MCP-Server über stdio betreiben
docmd add <name>     # Plugin oder Template installieren
```

## Plugins

Die Kern-Funktionalität wird von einem robusten Plugin-System bereitgestellt. Die Grundlagen sind standardmäßig enthalten, optionale Plugins können für spezifische Bedürfnisse hinzugefügt werden.

| Plugin | Status | Beschreibung |
| :--- | :---: | :--- |
| `ai` | Kern | RAG-gestützter KI-Assistent mit BYOK, lokalen Anbietern und Cloud Relay |
| `search` | Kern | Offline-Volltextsuche (Schlüsselwörter + optional semantisch via `docmd-search`) |
| `seo` | Kern | SEO-Tags und Open-Graph-Metadaten |
| `sitemap` | Kern | Generiert `sitemap.xml` |
| `git` | Kern | Git-Commit-Historie und letzte Aktualisierungsdaten |
| `analytics` | Kern | Schlanke Analytics-Integration |
| `llms` | Kern | AI-Kontext-Generierung (`llms.txt` / `llms-full.txt`) |
| `okf` | Kern | Open Knowledge Format Bundles für KI-Agenten (pro Locale) |
| `mermaid` | Kern | Mermaid-Diagramm-Unterstützung |
| `openapi` | Kern | Build-Time-OpenAPI-3.x-Spec-Renderer |
| `pwa` | Optional | Progressive Web App — Offline-Navigation |
| `threads` | Optional | Inline-Diskussions-Threads *(von @svallory)* |
| `math` | Optional | KaTeX / LaTeX-Mathematik-Rendering |

Optionale Plugins installieren:

```bash
docmd add <plugin-name>
```

Eigene bauen: [Plugin-Entwicklungs-Leitfaden](https://docs.docmd.io/de/development/building-plugins/)

## Konfiguration

Keine Konfiguration ist nötig, um zu starten. Fügen Sie eine `docmd.config.json` (oder `.ts` / `.js`) im Projektstamm nur dann hinzu, wenn Sie mehr Kontrolle brauchen:

```json
{
  "title": "Mein Projekt",
  "url": "https://docs.meinprojekt.de",
  "src": "./docs",
  "out": "./dist"
}
```

TypeScript- und JavaScript-Konfigurationsdateien werden für dynamische Werte unterstützt.

Vollständige Referenz: [Konfigurations-Übersicht](https://docs.docmd.io/de/configuration/overview)

## Projektstruktur

```text
my-docs/
├── docs/                ← Ihre Markdown-Dateien
├── assets/              ← Bilder und statische Dateien
├── docmd.config.json    ← Optionale Konfiguration
└── package.json
```

## Live-Editor

Ein browserbasierter Editor zum Schreiben und Vorschauen von Doku — kein lokales Setup erforderlich.

**Probieren Sie es aus auf [live.docmd.io](https://live.docmd.io)**

## Programmatische API

Verwenden Sie docmd in Node.js-Skripten, CI-Pipelines oder benutzerdefinierten Build-Schritten. (Unterstützt sowohl CommonJS als auch ESM.)

```javascript
import { build } from '@docmd/core';

await build('./docmd.config.json', { isDev: false });
```

Vollständige Referenz: [Node-API](https://docs.docmd.io/de/development/node-api-reference/)

## Community

- **Bugs & Probleme** → [GitHub Issues](https://github.com/docmd-io/docmd/issues)
- **Fragen & Ideen** → [Discussions](https://github.com/orgs/docmd-io/discussions)
- **Beitragen** → [CONTRIBUTING.md](.github/CONTRIBUTING.md)
- **Roadmap** → [GitHub Discussions](https://github.com/orgs/docmd-io/discussions/2)

## Unterstützung

- docmd bekannt zu machen ist der direkteste Weg, seine Entwicklung zu unterstützen. [Teilen Sie es auf X](https://twitter.com/intent/tweet?url=https://github.com/docmd-io/docmd&text=docmd%20-%20Dokumentation%20f%C3%BCr%20Menschen%20und%20Maschinen.) mit Freunden oder geben Sie ihm einen Stern.
- Falls docmd Ihnen Zeit spart, hilft ein [GitHub-Sponsoring](https://github.com/sponsors/mgks) sehr weiter.
- Ideen oder Bugs? Eröffnen Sie ein Issue oder eine PR, gerne auch mit eigenen Plugins.

## Lizenz

MIT — siehe [`LICENSE`](./LICENSE) für Details.