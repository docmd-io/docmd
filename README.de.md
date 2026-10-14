<div align="right">
  <sup>
    <a href="./README.md">EN</a> &nbsp;|&nbsp; <b>DE</b> &nbsp;|&nbsp; <a href="./README.zh.md">中文</a> &nbsp;|&nbsp; <a href="./README.es.md">ES</a> &nbsp;|&nbsp; <a href="./README.ja.md">日本語</a> &nbsp;|&nbsp; <a href="./README.fr.md">FR</a> &nbsp;|&nbsp; <a href="./README.ru.md">RU</a> &nbsp;|&nbsp; <a href="./README.tr.md">TR</a>
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
    <b>Dokumentation für Menschen und Maschinen.</b><br/>
    Eine Markdown-Quelle → Website, Suche, KI-Kontext, Agenten und Wissensformate.
  </p>

  <p>
    <a href="https://www.npmjs.com/package/@docmd/core"><img src="https://img.shields.io/npm/v/@docmd/core.svg?style=flat-square&color=CB3837" alt="npm version"></a>
    <a href="https://www.npmjs.com/package/@docmd/core?activeTab=versions"><img src="https://img.shields.io/npm/dm/@docmd/core.svg?style=flat-square&color=38bd24" alt="monatliche Downloads"></a>
    <a href="https://github.com/docmd-io/docmd"><img src="https://img.shields.io/github/stars/docmd-io/docmd?style=flat-square&logo=github" alt="GitHub-Sterne"></a>
    <a href="https://github.com/docmd-io/docmd/blob/main/LICENSE"><img src="https://img.shields.io/github/license/docmd-io/docmd.svg?style=flat-square&color=A31F34" alt="Lizenz"></a>
  </p>

  <h4>
    <a href="https://docmd.io">Website</a> &nbsp;·&nbsp;
    <a href="https://docs.docmd.io">Dokumentation</a> &nbsp;·&nbsp;
    <a href="https://cloud.docmd.io">Cloud Relay</a> &nbsp;·&nbsp;
    <a href="https://live.docmd.io">Live-Editor</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd-skills">Agent Skills</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd/issues">Issues</a>
  </h4>

  <br/>

  <a href="https://docmd.io">
    <img width="820" alt="docmd-Dokumentation — Vorschau im hellen und dunklen Modus" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-cover.webp" />
  </a>

</div>

## Schnellstart

Zeigen Sie docmd auf einen beliebigen Ordner mit Markdown-Dateien:

```bash
npx @docmd/core dev
```

Öffnen Sie `http://localhost:3000`.

Das ist alles. Die Navigation wird automatisch aus Ihrer Dateistruktur generiert. Keine Konfigurationsdatei, kein Frontmatter und kein Framework erforderlich.

Wenn Sie bereit zum Veröffentlichen sind:

```bash
npx @docmd/core build
```

docmd generiert eine statische Website, die auf Vercel, Cloudflare Pages, Netlify, GitHub Pages, S3, NGINX, Caddy oder jedem anderen statischen Host bereitgestellt werden kann.

**Erfordert Node.js 20+.**

<details>
  <summary><b>Globale Installation und Docker</b></summary>

<br/>

Global installieren:

```bash
npm install -g @docmd/core

# oder
pnpm add -g @docmd/core
```

Dann:

```bash
docmd dev
docmd build
```

Oder mit Docker ausführen:

```bash
docker run -p 3000:3000 ghcr.io/docmd-io/docmd:latest
```

> Heften Sie das Docker-Image auf ein bestimmtes Release für reproduzierbare Produktions-Builds an.

</details>

## Eine Quelle. Jede Ausgabe.

docmd ist ein Open-Source-Dokumentations-Compiler.

Anstatt Ihr Markdown nur als Eingabe für eine Website zu behandeln, kompiliert docmd dieselbe Quelle in Ausgaben für Leser, Suchmaschinen, LLMs, Coding-Agenten und Wissenssysteme.

```text
Markdown
   │
   ▼
 docmd
   │
   ├── → Statische Dokumentationsseite
   ├── → Offline-Suchindex
   ├── → llms.txt / llms-full.txt
   ├── → Open Knowledge Format (OKF)
   ├── → Sitemap + SEO-Metadaten
   ├── → robots.txt + Open Graph
   ├── → MCP-Schnittstelle für KI-Agenten
   └── → KI-Assistenten-Kontext
```

Ein Quellbaum. Eine Build-Pipeline. Keine getrennten Dokumentations- und KI-Wissens-Stacks zu verwalten.

## Warum docmd?

Dokumentation hat zunehmend mehr als einen Leser.

Menschen brauchen eine schnelle, gut navigierbare Website. Suchmaschinen brauchen strukturierte Metadaten. LLMs brauchen sauberen Kontext. Coding-Agenten brauchen Werkzeuge und Protokolle. RAG-Systeme brauchen strukturiertes Wissen.

docmd baut all dies zusammen, während Markdown stets im Mittelpunkt bleibt.

<a href="https://docs.docmd.io/comparison/">
  <img width="800" alt="docmd-Vergleich mit anderen Dokumentations-Tools" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-comparison.webp" />
</a>
<br/>
<b>Den vollständigen Vergleich mit <a href="https://docs.docmd.io/comparison/">Docusaurus, Mintlify und weiteren Dokumentations-Tools ansehen →</a></b>

## Features

### Zero Config, sofortiger Start

Zeigen Sie docmd auf einen beliebigen Markdown-Ordner und es läuft. Die Navigation wird automatisch aus Ihrer Dateistruktur generiert — kein Boilerplate, Frontmatter oder Build-Pipeline erforderlich, um loszulegen.

### Leichtgewichtig von Haus aus, schnell überall

docmd generiert statisches HTML mit minimalem Vanilla-JavaScript und schneller Navigation im SPA-Stil. Offline-Volltextsuche, Sitemap, kanonische URLs, Open-Graph-Metadaten und weitere Grundlagen sind direkt in der Ausgabe enthalten.

### Bereit für KI & Agenten

docmd behandelt maschinenlesbare Dokumentation als Teil des Builds, nicht als separaten Veröffentlichungsprozess.

* **KI-Assistent** — RAG-gestützter Chat, verankert in Ihrer Dokumentation
* **MCP-Server** — ermöglicht kompatiblen Coding-Agenten das Suchen, Lesen und Validieren Ihrer Dokumentation
* **`llms.txt` / `llms-full.txt`** — vollständiger, für LLMs lesbarer Dokumentations-Kontext
* **Open Knowledge Format (OKF)** — strukturierte Wissenspakete für KI- und RAG-Systeme
* **Agent Skills** — wiederverwendbare Anweisungen für LLMs und Coding-Agenten
* **Als Markdown kopieren / Kontext kopieren** — saubere Kontextextraktion direkt im Browser
* **Semantische Suche** — optionale Vektorsuche neben der integrierten Stichwortsuche

### Für Skalierbarkeit entwickelt

* Internationalisierung mit sprachabhängiger Suche und generierten Ausgaben
* Versionierung für mehrere Dokumentations-Releases
* Workspaces für Monorepos und Multi-Projekt-Setups
* OpenAPI 3.x-Rendering für API-Dokumentation
* Integrierte Vorlagen, benutzerdefiniertes CSS/JavaScript und Hell-/Dunkelmodus

## KI-Assistent & Cloud Relay

docmd enthält einen RAG-gestützten KI-Assistenten, der in Ihrer Dokumentation verankert ist.

Sie können ihn mit Ihrem eigenen Backend oder einem lokalen KI-Anbieter verbinden. Wenn Ihre Dokumentation als statische Website bereitgestellt wird, bietet **docmd Cloud Relay** stattdessen die gehostete Brücke.

```text
Ihre Dokumentation
        │
        ▼
 @docmd/plugin-ai
        │
        ▼
 docmd Cloud Relay
        │
        ▼
 Ihr KI-Anbieter
```

Cloud Relay sendet KI-Anfragen sicher an den von Ihnen gewählten Anbieter, sodass keine Zugangsdaten an den Browser übertragen werden müssen und Sie kein eigenes KI-Backend betreiben müssen.

**Cloud Relay ist mit Ihrem eigenen KI-Anbieterschlüssel kostenlos nutzbar.**

* Bringen Sie Ihren eigenen Anbieter und Ihr eigenes Modell mit
* Halten Sie API-Zugangsdaten vom Client fern
* Funktioniert mit statischem Hosting
* Kein KI-Backend bereitzustellen oder zu warten
* Einblicke in Nutzung und Leserfragen
* Mehrere Dokumentationsprojekte über ein Konto verbinden

**[Cloud Relay einrichten →](https://cloud.docmd.io)** • [Dokumentation zum KI-Assistenten →](https://docs.docmd.io/guides/ai/ai-assistant/)

> Cloud Relay ist kostenlos. Die Modellnutzung kann von Ihrem gewählten KI-Anbieter separat berechnet werden.

## CLI

```bash
docmd dev            # Lokalen Entwicklungsserver starten
docmd build          # Für Produktion bauen
docmd live           # Browser-basierten Live-Editor starten
docmd init           # Konfigurationsdatei erstellen
docmd doctor         # Konfiguration und Plugin-Status überprüfen
docmd validate       # Interne Dokumentations-Links prüfen
docmd migrate        # Von Docusaurus, VitePress, MkDocs oder Starlight migrieren
docmd deploy         # Deployment-Konfiguration generieren
docmd mcp            # MCP-Server über stdio ausführen
docmd add <name>     # Plugin oder Template installieren
docmd stop           # Laufende docmd-Entwicklungsserver stoppen
```

**Alle [CLI-Befehle ansehen →](https://docs.docmd.io/reference/cli-commands/)**

## Plugins

docmd basiert auf einem Plugin-System. Gängige Dokumentationsfunktionen sind direkt im Kern enthalten, während optionale Plugins bei Bedarf installiert werden können.

| Plugin      |  Status  | Beschreibung                                                         |
| :---------- | :------: | :------------------------------------------------------------------- |
| `ai`        |   Kern   | RAG-gestützter KI-Assistent mit BYOK, lokalen Anbietern und Cloud Relay |
| `search`    |   Kern   | Offline-Stichwortsuche mit optionaler semantischer Suche             |
| `seo`       |   Kern   | SEO- und Open-Graph-Metadaten                                        |
| `sitemap`   |   Kern   | Generiert `sitemap.xml`                                              |
| `git`       |   Kern   | Git-Historie und Metadaten zur letzten Aktualisierung                |
| `analytics` |   Kern   | Schlanke Analytics-Integration                                       |
| `llms`      |   Kern   | Generiert `llms.txt` und `llms-full.txt`                             |
| `okf`       |   Kern   | Open Knowledge Format Bundles                                        |
| `mermaid`   |   Kern   | Mermaid-Diagramm-Rendering                                           |
| `openapi`   |   Kern   | OpenAPI 3.x-Dokumentations-Renderer                                  |
| `pwa`       | Optional | Progressive Web App und Offline-Navigation                           |
| `threads`   | Optional | Inline-Diskussions-Threads *(von @svallory)*                         |
| `math`      | Optional | KaTeX- / LaTeX-Rendering                                             |

Ein optionales Plugin installieren:

```bash
docmd add <plugin-name>
```

**Erstellen Sie Ihr eigenes: [Plugin-Entwicklungs-Leitfaden →](https://docs.docmd.io/development/building-plugins/)**

## Konfiguration

Konfiguration ist optional.

Fügen Sie eine `docmd.config.json`, `docmd.config.ts` oder `docmd.config.js` im Projektstamm hinzu, wenn Sie mehr Kontrolle benötigen:

```json
{
  "title": "Mein Projekt",
  "url": "https://docs.meinprojekt.de",
  "src": "./docs",
  "out": "./dist"
}
```

TypeScript- und JavaScript-Konfigurationen können verwendet werden, wenn dynamische Werte erforderlich sind.

**[Konfigurations-Referenz →](https://docs.docmd.io/configuration/overview)**

## Programmatische API

Verwenden Sie docmd aus Node.js-Skripten, CI-Pipelines oder benutzerdefinierten Build-Systemen.

```javascript
import { build } from '@docmd/core';

// Dokumentation programmatisch bauen.
await build('./docmd.config.json', { isDev: false });
```

CommonJS und ESM werden unterstützt.

**[Node-API-Referenz →](https://docs.docmd.io/development/node-api-reference/)**

## Migration

Bestehende Dokumentation muss nicht von Grund auf neu aufgebaut werden.

```bash
docmd migrate
```

Migrations-Tools sind für unterstützte Dokumentations-Frameworks wie Docusaurus, VitePress, MkDocs und Starlight verfügbar.

**[Dokumentation zur Migration →](https://docs.docmd.io)**

## Open Source

Ihre Dokumentation ist das intellektuelle Herzstück Ihres Projekts. Sie gehört in einfache Markdown-Dateien in Ihrem Git-Repository — portabel, versionskontrolliert und nachvollziehbar.

**Der docmd-Compiler und die offiziellen Kern-Plugins stehen unter der MIT-Lizenz und bleiben dauerhaft kostenlos nutzbar, ohne kostenpflichtige Compiler-Funktionen.**

Generierte Dokumentationen können überall gehostet werden und erfordern keine von docmd gehostete Infrastruktur.

## Community

* **Dokumentation** → [docs.docmd.io](https://docs.docmd.io)
* **Fragen & Ideen** → [GitHub Discussions](https://github.com/orgs/docmd-io/discussions)
* **Bugs & Feature-Anfragen** → [GitHub Issues](https://github.com/docmd-io/docmd/issues)
* **Beitragen** → [CONTRIBUTING.md](.github/CONTRIBUTING.md)
* **Roadmap** → [GitHub Discussions](https://github.com/orgs/docmd-io/discussions/2)

## docmd unterstützen

Wenn docmd für Sie nützlich ist:

* Vergeben Sie dem Repository einen ⭐
* Teilen Sie es mit anderen, die Dokumentationen erstellen
* Eröffnen Sie Issues, tragen Sie Fehlerbehebungen bei oder entwickeln Sie ein Plugin
* [Entwicklung auf GitHub sponsern](https://github.com/sponsors/mgks)

## Lizenz

MIT-Lizenz. Siehe [LICENSE](LICENSE) für Details.