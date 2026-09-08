<div align="right">
  <sup>
    <a href="./README.md">EN</a> &nbsp;|&nbsp; <a href="./README.de.md">DE</a> &nbsp;|&nbsp; <a href="./README.zh.md">中文</a> &nbsp;|&nbsp; <a href="./README.es.md">ES</a> &nbsp;|&nbsp; <a href="./README.ja.md">日本語</a> &nbsp;|&nbsp; <b>FR</b> &nbsp;|&nbsp; <a href="./README.ru.md">RU</a>
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

  <p><b>Documentation pour les humains et les machines.</b><br/>Une source Markdown → site web, recherche, contexte IA et protocoles d'agents. Le tout généré ensemble.</p>

  <p>
    <a href="https://www.npmjs.com/package/@docmd/core"><img src="https://img.shields.io/npm/v/@docmd/core.svg?style=flat-square&color=CB3837" alt="version npm"></a>
    <a href="https://www.npmjs.com/package/@docmd/core?activeTab=versions"><img src="https://img.shields.io/npm/dm/@docmd/core.svg?style=flat-square&color=38bd24" alt="téléchargements mensuels"></a>
    <a href="https://github.com/docmd-io/docmd"><img src="https://img.shields.io/github/stars/docmd-io/docmd?style=flat-square&logo=github" alt="étoiles GitHub"></a>
    <a href="https://github.com/docmd-io/docmd/blob/main/LICENSE"><img src="https://img.shields.io/github/license/docmd-io/docmd.svg?style=flat-square&color=A31F34" alt="licence"></a>
  </p>

  <h4>
    <a href="https://docmd.io">Site Web</a> &nbsp;·&nbsp;
    <a href="https://docs.docmd.io/fr/">Documentation</a> &nbsp;·&nbsp;
    <a href="https://cloud.docmd.io">AI Cloud Relay</a> &nbsp;·&nbsp;
    <a href="https://live.docmd.io">Éditeur en direct</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd-skills">Agent Skills</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd/issues">Signaler un bug</a>
  </h4>

  <br/>

  <a href="https://docs.docmd.io/fr/">
    <img width="820" alt="Thème par défaut de docmd — aperçu en mode clair et sombre" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-cover.webp" />
  </a>

  <br/><br/>

</div>

> ## ✦ 0.9 Serie — IA, Automatisation & Sécurité
>
> La série 0.9.x marque la transition de docmd d'un générateur de documentation
> compatible IA vers une plateforme de documentation conçue à la fois pour les
> **humains et les agents d'IA**.
>
> La série introduit l'**Assistant IA**, permettant de consulter la documentation
> de façon conversationnelle via votre propre fournisseur, une IA locale, ou le
> **docmd Cloud Relay** pour les sites statiques sans backend dédié.
> Elle enrichit également l'écosystème IA de docmd avec le support MCP, la génération
> de contexte LLM, les Agent Skills et des formats de connaissances structurés.
>
> En parallèle de l'IA, cette série se concentre sur la **sécurité, la confidentialité et l'automatisation**,
> tout en continuant d'améliorer l'expérience documentaire centrale, la recherche,
> le déploiement et les flux de travail des développeurs.
>
> [Suivre la feuille de route 0.9 →](https://github.com/orgs/docmd-io/discussions/10)

## Démarrage rapide

Exécutez docmd dans n'importe quel dossier contenant des fichiers Markdown — aucune installation requise :

```bash
npx @docmd/core dev
```

<details>
  <summary><b>Disponible sur <code>http://localhost:3000</code></b></summary><br>

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

La navigation est générée à partir de la structure de vos fichiers. Aucun fichier de configuration, aucun frontmatter obligatoire, aucun framework à apprendre.

**Quand vous êtes prêt à publier :**

```bash
npx @docmd/core build
```

Génère un site statique hautement optimisé (SPA) prêt à être déployé sur Vercel, Cloudflare Pages, Netlify, GitHub Pages ou n'importe quel hébergeur statique.

**Préréquis :** Node.js 18+

<details>
  <summary><b>Ou installez-le globalement / via Docker</b></summary><br/>

```bash
# Installer globalement via npm
npm install -g @docmd/core

# Ou via pnpm
pnpm add -g @docmd/core

# Exécuter
docmd dev    # démarrer le serveur de développement
docmd build  # construire pour le déploiement
```

Ou exécuter via Docker :

```bash
docker run -p 3000:3000 ghcr.io/docmd-io/docmd:0.9.0
```

> Épinglez une version pour des builds reproductibles.

</details>

## Pourquoi docmd ?

<div align="center">
  <img width="1000" alt="image" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-comparison.webp" />
</div>

<!--
| Fonctionnalité | docmd | Docusaurus | MkDocs | VitePress | Mintlify |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Config requise** | **Aucune** | `docusaurus.config.js` | `mkdocs.yml` | `config.mts` | `docs.json` |
| **Charge utile JS** | **~18 kb** | ~250 kb | ~40 kb | ~50 kb | ~120 kb |
| **Navigation** | **SPA Instantanée** | React SPA | Rechargement complet | Vue SPA | SPA Hébergée |
| **Gestion des versions** | **Native** | Native (complexe) | plugin mike | Manuel | Native |
| **i18n** | **Native** | Native (complexe) | Basée sur plugins | Native | Native |
| **Multi-projet** | **Native** | Plugin | Plugin | - | - |
| **Recherche** | **Intégrée** | Algolia (cloud) | Intégrée | MiniSearch | Cloud |
| **Assistant IA** | **Intégré — BYOK + Cloud Relay** | - | - | - | Intégré (Cloud) |
| **Contexte IA (`llms.txt`)** | **Intégré** | - | - | - | Intégré |
| **Serveur MCP** | **Intégré** | - | - | - | Intégré |
| **Agent Skills** | **Intégré** | - | - | - | - |
| **Image Docker** | **Officielle** | - | Officielle | - | - |
| **Auto-hébergé** | **Oui** | Oui | Oui | Oui | - |
| **Coût** | **Gratuit (OSS)** | Gratuit (OSS) | Gratuit (OSS) | Gratuit (OSS) | Freemium |
-->

**Voir la [Comparaison complète avec Docusaurus, Mintlify et autres →](https://docs.docmd.io/comparison/)**

## Fonctionnalités

### Zéro configuration, démarrage instantané
Pointez docmd vers n'importe quel dossier Markdown et il fonctionne. La navigation est construite automatiquement depuis votre arborescence. Vous pouvez rédiger votre premier document et le publier en moins d'une minute — sans code superflu, sans pipeline de build à configurer, sans décision préalable.

### Ultra-léger par défaut, rapide partout
La charge utile JavaScript par défaut est d'environ 18 kb. La navigation entre les pages s'effectue sous forme de SPA instantanée. Le rendu produit du HTML statique — optimisé pour le SEO, incluant sitemap, URLs canoniques et métadonnées Open Graph. La recherche plein texte hors-ligne est intégrée, sans nécessiter de service cloud.

### Conçu pour l'IA
docmd traite l'IA comme un moyen de premier ordre pour consommer la documentation — sans remplacer la documentation elle-même.
- **Assistant IA (`@docmd/plugin-ai`)** — Chat propulsé par RAG et ancré dans votre documentation. Utilisez votre propre clé API ou connectez un fournisseur d'IA local, avec le support de plus de 100 fournisseurs grâce à AIPlug.
- **Cloud Relay** — activez l'Assistant IA sur une documentation statique sans avoir à gérer votre propre backend IA. [Essayer →](https://cloud.docmd.io)
- **Serveur MCP** — `docmd mcp` expose vos documents aux agents d'IA via stdio, leur permettant de rechercher, lire et valider le contenu directement.
- **Contexte (`llms.txt` / `llms-full.txt`)** — contexte documentaire complet généré au moment du build.
- **Agent Skills** — jeux d'instructions modulaires pour les LLM et agents d'IDE.
- **Open Knowledge Format (OKF)** — paquets de connaissances structurés et multilingues pour les systèmes d'IA.
- **Copier en Markdown / Copier le contexte** — boutons d'extraction de contexte en un clic directement depuis le navigateur.

### Conçu pour évoluer
- Internationalisation avec builds multi-locales (index de recherche par langue, llms, okf, hreflang)
- Gestion des versions pour plusieurs livraisons de documentation (détection automatique de la version courante)
- Workspaces pour les monorepos et configurations multi-projets
- Système de plugins pour étendre les fonctionnalités de base (validation des types de retour par hook, compatible async)
- Thématisation complète, modèles intégrés, CSS/JS personnalisé, mode clair/sombre

## CLI

```bash
docmd dev            # serveur de développement local
docmd build          # construire pour le déploiement
docmd live           # Éditeur en direct basé sur le navigateur
docmd init           # initialiser un docmd.config.json dans le dossier actuel
docmd stop           # arrêter les serveurs `docmd dev` / `docmd live` en cours
docmd doctor         # diagnostic pré-vol : configuration + statut d'installation des plugins
docmd migrate        # migrer vers docmd depuis Docusaurus, VitePress, MkDocs ou Starlight
docmd deploy         # générer la configuration pour Docker, NGINX, Caddy, Vercel, Netlify
docmd validate       # vérifier l'intégralité des liens internes
docmd mcp            # exécuter en tant que serveur MCP via stdio
docmd add <nom>      # installer un plugin ou un modèle
```

## Plugins

Les fonctionnalités de base sont propulsées par un système de plugins robuste. L'essentiel est inclus par défaut, et des plugins optionnels peuvent être ajoutés pour des besoins spécifiques.

| Plugin | Statut | Description |
| :--- | :---: | :--- |
| `ai` | Cœur | Assistant IA RAG avec support BYOK, fournisseurs locaux et Cloud Relay |
| `search` | Cœur | Recherche plein texte hors-ligne (mots-clés + sémantique optionnelle via `docmd-search`) |
| `seo` | Cœur | Balises SEO et métadonnées Open Graph |
| `sitemap` | Cœur | Génère `sitemap.xml` |
| `git` | Cœur | Historique des commits Git et dates de dernière mise à jour |
| `analytics` | Cœur | Intégration d'outils d'analyse légers |
| `llms` | Cœur | Génération de contexte IA (`llms.txt` / `llms-full.txt`) |
| `okf` | Cœur | Paquets Open Knowledge Format pour agents IA (par langue) |
| `mermaid` | Cœur | Support des diagrammes Mermaid |
| `openapi` | Cœur | Rendu des spécifications OpenAPI 3.x au build |
| `pwa` | Optionnel | Progressive Web App — navigation hors-ligne |
| `threads` | Optionnel | Fil de discussion intégré *(par @svallory)* |
| `math` | Optionnel | Rendu des formules mathématiques KaTeX / LaTeX |

Installer des plugins optionnels :

```bash
docmd add <nom-du-plugin>
```

Créez le vôtre : [Guide de développement de plugins](https://docs.docmd.io/fr/development/building-plugins/)

## Configuration

Aucune configuration n'est requise pour commencer. Ajoutez un fichier `docmd.config.json` (ou `.ts` / `.js`) à la racine de votre projet uniquement si vous avez besoin de plus de contrôle :

```json
{
  "title": "Mon Projet",
  "url": "https://docs.monprojet.fr",
  "src": "./docs",
  "out": "./dist"
}
```

Les fichiers de configuration TypeScript et JavaScript sont pris en charge pour les valeurs dynamiques.

Référence complète : [Aperçu de la configuration](https://docs.docmd.io/fr/configuration/overview)

## Structure du projet

```text
mes-docs/
├── docs/                ← Vos fichiers markdown
├── assets/              ← Images et fichiers statiques
├── docmd.config.json    ← Configuration optionnelle
└── package.json
```

## Éditeur en direct (Live Editor)

Un éditeur basé sur le navigateur pour rédiger et prévisualiser votre documentation — aucune configuration locale nécessaire.

**Essayez-le sur [live.docmd.io](https://live.docmd.io)**

## API programmatique

Utilisez docmd dans vos scripts Node.js, pipelines CI ou étapes de build personnalisées (compatible CommonJS et ESM).

```javascript
import { build } from '@docmd/core';

await build('./docmd.config.json', { isDev: false });
```

Référence complète : [API Node](https://docs.docmd.io/fr/development/node-api-reference/)

## Communauté

- **Bugs & problèmes** → [Issues GitHub](https://github.com/docmd-io/docmd/issues)
- **Questions & idées** → [Discussions](https://github.com/orgs/docmd-io/discussions)
- **Contribuer** → [CONTRIBUTING.md](.github/CONTRIBUTING.md)
- **Feuille de route** → [Discussions GitHub](https://github.com/orgs/docmd-io/discussions/2)

## Soutenir le projet

- Faire connaître docmd est le moyen le plus direct de soutenir son développement. [Partagez-le sur X](https://twitter.com/intent/tweet?url=https://github.com/docmd-io/docmd&text=docmd%20-%20Une%20documentation%20prête%20pour%20la%20production%20à%20partir%20de%20Markdown%20en%20quelques%20secondes.) avec vos amis ou attribuez-lui une étoile.
- Si docmd vous fait gagner du temps, un [sponsoring GitHub](https://github.com/sponsors/mgks) est grandement apprécié.
- Des idées ou des bugs ? Ouvrez une issue ou une PR, et n'hésitez pas à proposer vos propres plugins.

## Licence

Licence MIT. Consultez [`LICENSE`](./LICENSE) pour plus de détails.