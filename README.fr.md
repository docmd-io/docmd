<div align="right">
  <sup>
    <a href="./README.md">EN</a> &nbsp;|&nbsp; <a href="./README.de.md">DE</a> &nbsp;|&nbsp; <a href="./README.zh.md">中文</a> &nbsp;|&nbsp; <a href="./README.es.md">ES</a> &nbsp;|&nbsp; <a href="./README.ja.md">日本語</a> &nbsp;|&nbsp; <b>FR</b> &nbsp;|&nbsp; <a href="./README.ru.md">RU</a> &nbsp;|&nbsp; <a href="./README.tr.md">TR</a>
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
    <b>Documentation pour les humains et les machines.</b><br/>
    Une source Markdown → site web, recherche, contexte IA, agents et formats de connaissances.
  </p>

  <p>
    <a href="https://www.npmjs.com/package/@docmd/core"><img src="https://img.shields.io/npm/v/@docmd/core.svg?style=flat-square&color=CB3837" alt="version npm"></a>
    <a href="https://www.npmjs.com/package/@docmd/core?activeTab=versions"><img src="https://img.shields.io/npm/dm/@docmd/core.svg?style=flat-square&color=38bd24" alt="téléchargements mensuels"></a>
    <a href="https://github.com/docmd-io/docmd"><img src="https://img.shields.io/github/stars/docmd-io/docmd?style=flat-square&logo=github" alt="étoiles GitHub"></a>
    <a href="https://github.com/docmd-io/docmd/blob/main/LICENSE"><img src="https://img.shields.io/github/license/docmd-io/docmd.svg?style=flat-square&color=A31F34" alt="licence"></a>
  </p>

  <h4>
    <a href="https://docmd.io">Site web</a> &nbsp;·&nbsp;
    <a href="https://docs.docmd.io">Documentation</a> &nbsp;·&nbsp;
    <a href="https://cloud.docmd.io">Cloud Relay</a> &nbsp;·&nbsp;
    <a href="https://live.docmd.io">Éditeur en direct</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd-skills">Agent Skills</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd/issues">Issues</a>
  </h4>

  <br/>

  <a href="https://docmd.io">
    <img width="820" alt="Documentation docmd — aperçu en mode clair et sombre" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-cover.webp" />
  </a>

</div>

## Démarrage rapide

Pointez docmd vers un dossier de fichiers Markdown :

```bash
npx @docmd/core dev
```

Ouvrez `http://localhost:3000`.

C'est tout. La navigation est générée automatiquement à partir de votre arborescence de fichiers. Aucun fichier de configuration, frontmatter ou framework requis.

Lorsque vous êtes prêt à déployer :

```bash
npx @docmd/core build
```

docmd génère un site statique déployable sur Vercel, Cloudflare Pages, Netlify, GitHub Pages, S3, NGINX, Caddy ou tout autre hébergeur statique.

**Nécessite Node.js 20+.**

<details>
  <summary><b>Installation globale et Docker</b></summary>

<br/>

Installer globalement :

```bash
npm install -g @docmd/core

# ou
pnpm add -g @docmd/core
```

Puis :

```bash
docmd dev
docmd build
```

Ou exécuter avec Docker :

```bash
docker run -p 3000:3000 ghcr.io/docmd-io/docmd:latest
```

> Épinglez l'image Docker à une version spécifique pour des builds de production reproductibles.

</details>

## Une source. Toutes les sorties.

docmd est un compilateur de documentation open source.

Au lieu de considérer votre Markdown comme une simple entrée pour un site web, docmd compile la même source en sorties adaptées aux lecteurs, aux moteurs de recherche, aux LLMs, aux agents de code et aux systèmes de connaissances.

```text
Markdown
   │
   ▼
 docmd
   │
   ├── → Site de documentation statique
   ├── → Index de recherche hors-ligne
   ├── → llms.txt / llms-full.txt
   ├── → Open Knowledge Format (OKF)
   ├── → Sitemap + métadonnées SEO
   ├── → robots.txt + Open Graph
   ├── → Interface MCP pour agents d'IA
   └── → Contexte de l'Assistant IA
```

Une seule arborescence source. Un seul pipeline de build. Aucune pile distincte de documentation et de connaissances IA à maintenir.

## Pourquoi docmd ?

La documentation s'adresse de plus en plus à plus d'un type de lecteur.

Les humains ont besoin d'un site web rapide et facile à naviguer. Les moteurs de recherche ont besoin de métadonnées structurées. Les LLMs ont besoin d'un contexte propre. Les agents de code ont besoin d'outils et de protocoles. Les systèmes RAG ont besoin de connaissances structurées.

docmd rassemble tout cela tout en plaçant Markdown au centre.

<a href="https://docs.docmd.io/comparison/">
  <img width="800" alt="Comparaison de docmd avec d'autres outils de documentation" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-comparison.webp" />
</a>
<br/>
<b>Voir la comparaison complète avec <a href="https://docs.docmd.io/comparison/">Docusaurus, Mintlify et d'autres outils de documentation →</a></b>

## Fonctionnalités

### Zéro configuration, démarrage instantané

Pointez docmd vers n'importe quel dossier Markdown et il fonctionne. La navigation est générée automatiquement à partir de votre arborescence de fichiers — aucun boilerplate, frontmatter ou pipeline de build requis pour démarrer.

### Léger par défaut, rapide partout

docmd génère du HTML statique avec un minimum de JavaScript vanilla et une navigation rapide de type SPA. Recherche plein texte hors ligne, sitemap, URLs canoniques, métadonnées Open Graph et autres éléments essentiels sont intégrés directement dans le rendu.

### Prêt pour l'IA et les agents

docmd traite la documentation lisible par machine comme une partie intégrante du build, et non comme un flux de publication séparé.

* **Assistant IA** — Chat basé sur RAG ancré dans votre documentation
* **Serveur MCP** — permet aux agents de code compatibles de rechercher, lire et valider votre documentation
* **`llms.txt` / `llms-full.txt`** — contexte documentaire complet lisible par les LLMs
* **Open Knowledge Format (OKF)** — paquets de connaissances structurés pour l'IA et les systèmes RAG
* **Agent Skills** — instructions réutilisables pour les LLMs et agents de code
* **Copier en Markdown / Copier le contexte** — extraction de contexte propre directement depuis le navigateur
* **Recherche sémantique** — recherche vectorielle optionnelle aux côtés de la recherche par mots-clés intégrée

### Conçu pour évoluer

* Internationalisation avec recherche par langue et sorties générées
* Gestion des versions pour plusieurs livraisons de documentation
* Workspaces pour monorepos et configurations multi-projets
* Rendu OpenAPI 3.x pour la documentation d'API
* Modèles intégrés, CSS/JavaScript personnalisés et mode clair/sombre

## Assistant IA & Cloud Relay

docmd comprend un Assistant IA propulsé par RAG et ancré dans votre documentation.

Vous pouvez le connecter à votre propre backend ou à un fournisseur d'IA local. Si votre documentation est déployée en tant que site statique, **docmd Cloud Relay** fournit la passerelle hébergée.

```text
Votre documentation
        │
        ▼
 @docmd/plugin-ai
        │
        ▼
 docmd Cloud Relay
        │
        ▼
 Votre fournisseur d'IA
```

Cloud Relay transmet de manière sécurisée les requêtes d'IA au fournisseur de votre choix, évitant ainsi d'exposer les identifiants au navigateur et vous dispensant d'administrer un backend d'IA.

**Cloud Relay est gratuit à utiliser avec votre propre clé de fournisseur d'IA.**

* Utilisez votre propre fournisseur et modèle
* Gardez les clés d'API hors du navigateur client
* Fonctionne parfaitement avec l'hébergement statique
* Aucun backend d'IA à déployer ou maintenir
* Visibilité sur l'utilisation et questions fréquentes des lecteurs
* Connectez plusieurs projets de documentation depuis un seul compte

**[Configurer Cloud Relay →](https://cloud.docmd.io)** • [Documentation de l'Assistant IA →](https://docs.docmd.io/guides/ai/ai-assistant/)

> Cloud Relay est gratuit. L'utilisation des modèles peut être facturée séparément par votre fournisseur d'IA.

## CLI

```bash
docmd dev            # Démarrer le serveur de développement local
docmd build          # Construire pour la production
docmd live           # Démarrer l'Éditeur en direct basé sur le navigateur
docmd init           # Créer un fichier de configuration
docmd doctor         # Vérifier la configuration et le statut des plugins
docmd validate       # Vérifier les liens internes de la documentation
docmd migrate        # Migrer depuis Docusaurus, VitePress, MkDocs ou Starlight
docmd deploy         # Générer la configuration de déploiement
docmd mcp            # Exécuter le serveur MCP via stdio
docmd add <name>     # Installer un plugin ou un modèle
docmd stop           # Arrêter les serveurs de développement docmd en cours d'exécution
```

**Voir toutes les [Commandes CLI →](https://docs.docmd.io/reference/cli-commands/)**

## Plugins

docmd est conçu autour d'un système de plugins. Les fonctionnalités courantes de documentation sont intégrées au cœur, tandis que des plugins optionnels peuvent être installés selon les besoins.

| Plugin      |  Statut  | Description                                                          |
| :---------- | :------: | :------------------------------------------------------------------- |
| `ai`        |   Cœur   | Assistant IA RAG avec support BYOK, fournisseurs locaux et Cloud Relay |
| `search`    |   Cœur   | Recherche par mots-clés hors-ligne avec recherche sémantique optionnelle |
| `seo`       |   Cœur   | Métadonnées SEO et Open Graph                                        |
| `sitemap`   |   Cœur   | Génère `sitemap.xml`                                                 |
| `git`       |   Cœur   | Historique Git et métadonnées de dernière mise à jour               |
| `analytics` |   Cœur   | Intégration d'outils d'analyse légers                                |
| `llms`      |   Cœur   | Génère `llms.txt` et `llms-full.txt`                                 |
| `okf`       |   Cœur   | Paquets Open Knowledge Format                                        |
| `mermaid`   |   Cœur   | Rendu de diagrammes Mermaid                                          |
| `openapi`   |   Cœur   | Moteur de rendu de documentation OpenAPI 3.x                         |
| `pwa`       | Optionnel| Progressive Web App et navigation hors-ligne                         |
| `threads`   | Optionnel| Fils de discussion intégrés à la documentation *(par @svallory)*     |
| `math`      | Optionnel| Rendu mathématique KaTeX / LaTeX                                     |

Installer un plugin optionnel :

```bash
docmd add <plugin-name>
```

**Créez le vôtre : [Guide de développement de plugins →](https://docs.docmd.io/development/building-plugins/)**

## Configuration

La configuration est optionnelle.

Ajoutez un fichier `docmd.config.json`, `docmd.config.ts` ou `docmd.config.js` à la racine de votre projet si vous avez besoin de plus de contrôle :

```json
{
  "title": "Mon Projet",
  "url": "https://docs.monprojet.fr",
  "src": "./docs",
  "out": "./dist"
}
```

Les configurations en TypeScript et JavaScript peuvent être utilisées lorsque des valeurs dynamiques sont nécessaires.

**[Référence de configuration →](https://docs.docmd.io/configuration/overview)**

## API programmatique

Utilisez docmd depuis des scripts Node.js, des pipelines CI ou des systèmes de build personnalisés.

```javascript
import { build } from '@docmd/core';

// Construire la documentation par programmation.
await build('./docmd.config.json', { isDev: false });
```

CommonJS et ESM sont pris en charge.

**[Référence de l'API Node →](https://docs.docmd.io/development/node-api-reference/)**

## Migration

Une documentation existante n'a pas besoin de repartir de zéro.

```bash
docmd migrate
```

Des outils de migration sont disponibles pour les frameworks de documentation pris en charge, notamment Docusaurus, VitePress, MkDocs et Starlight.

**[Documentation sur la migration →](https://docs.docmd.io)**

## Open Source

Votre documentation est le cœur intellectuel de votre projet. Elle a sa place dans de simples fichiers Markdown au sein de votre dépôt Git — portable, versionnée et vérifiable.

**Le compilateur docmd et les plugins officiels de base sont sous licence MIT et resteront gratuits à utiliser, sans aucune fonctionnalité de compilation payante.**

La documentation générée peut être hébergée n'importe où et ne dépend d'aucune infrastructure hébergée par docmd.

## Communauté

* **Documentation** → [docs.docmd.io](https://docs.docmd.io)
* **Questions & idées** → [GitHub Discussions](https://github.com/orgs/docmd-io/discussions)
* **Bugs & demandes de fonctionnalités** → [GitHub Issues](https://github.com/docmd-io/docmd/issues)
* **Contribuer** → [CONTRIBUTING.md](.github/CONTRIBUTING.md)
* **Feuille de route** → [GitHub Discussions](https://github.com/orgs/docmd-io/discussions/2)

## Soutenir docmd

Si docmd vous est utile :

* Donnez une ⭐ au dépôt
* Partagez-le avec quelqu'un qui rédige de la documentation
* Ouvrez des issues, proposez des correctifs ou créez un plugin
* [Sponsorisez le développement sur GitHub](https://github.com/sponsors/mgks)

## Licence

Licence MIT. Consultez [LICENSE](LICENSE) pour plus de détails.