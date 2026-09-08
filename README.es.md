<div align="right">
  <sup>
    <a href="./README.md">EN</a> &nbsp;|&nbsp; <a href="./README.de.md">DE</a> &nbsp;|&nbsp; <a href="./README.zh.md">中文</a> &nbsp;|&nbsp; <b>ES</b> &nbsp;|&nbsp; <a href="./README.ja.md">日本語</a> &nbsp;|&nbsp; <a href="./README.fr.md">FR</a> &nbsp;|&nbsp; <a href="./README.ru.md">RU</a>
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

  <p><b>Documentación para humanos y máquinas.</b><br/>Una fuente Markdown → sitio web, búsqueda, contexto IA y protocolos de agentes. Todo generado junto.</p>

  <p>
    <a href="https://www.npmjs.com/package/@docmd/core"><img src="https://img.shields.io/npm/v/@docmd/core.svg?style=flat-square&color=CB3837" alt="versión npm"></a>
    <a href="https://www.npmjs.com/package/@docmd/core?activeTab=versions"><img src="https://img.shields.io/npm/dm/@docmd/core.svg?style=flat-square&color=38bd24" alt="descargas mensuales"></a>
    <a href="https://github.com/docmd-io/docmd"><img src="https://img.shields.io/github/stars/docmd-io/docmd?style=flat-square&logo=github" alt="estrellas en GitHub"></a>
    <a href="https://github.com/docmd-io/docmd/blob/main/LICENSE"><img src="https://img.shields.io/github/license/docmd-io/docmd.svg?style=flat-square&color=A31F34" alt="licencia"></a>
  </p>

  <h4>
    <a href="https://docmd.io">Sitio Web</a> &nbsp;·&nbsp;
    <a href="https://docs.docmd.io/es/">Documentación</a> &nbsp;·&nbsp;
    <a href="https://cloud.docmd.io">AI Cloud Relay</a> &nbsp;·&nbsp;
    <a href="https://live.docmd.io">Editor en Vivo</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd-skills">Agent Skills</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd/issues">Reportar un Error</a>
  </h4>

  <br/>

  <a href="https://docs.docmd.io/es/">
    <img width="820" alt="Tema predeterminado de docmd — vista previa en modo claro y oscuro" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-cover.webp" />
  </a>

  <br/><br/>

</div>

> ## ✦ 0.9 Serie — IA, Automatización y Seguridad
>
> La serie 0.9.x es donde docmd evoluciona de un generador de documentación
> preparado para IA a una plataforma de documentación diseñada tanto para
> **personas como para agentes de IA**.
>
> La serie introduce el **Asistente de IA**, que permite consultar la documentación
> de forma conversacional utilizando tu propio proveedor, IA local o el
> **docmd Cloud Relay** para sitios estáticos que no tienen su propio backend.
> También expande el ecosistema de IA de docmd con MCP, contexto generado para LLM,
> Agent Skills y formatos de conocimiento estructurados.
>
> Junto con la IA, esta serie se enfoca en **seguridad, privacidad y automatización**,
> mientras continúa mejorando la experiencia central de documentación, búsqueda,
> despliegue y flujos de trabajo para desarrolladores.
>
> [Sigue el mapa de ruta 0.9 →](https://github.com/orgs/docmd-io/discussions/10)

## Inicio Rápido

Ejecuta docmd en cualquier carpeta con archivos Markdown — sin necesidad de instalación:

```bash
npx @docmd/core dev
```

<details>
  <summary><b>Disponible en <code>http://localhost:3000</code></b></summary><br>

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

La navegación se genera automáticamente a partir de la estructura de tus archivos. Sin archivo de configuración, sin frontmatter obligatorio, sin marcos que aprender.

**Cuando estés listo para desplegar:**

```bash
npx @docmd/core build
```

Genera un sitio estático altamente optimizado (SPA) listo para desplegar en Vercel, Cloudflare Pages, Netlify, GitHub Pages o cualquier host estático.

**Requisitos:** Node.js 18+

<details>
  <summary><b>O instala globalmente / vía Docker</b></summary><br/>

```bash
# Instalar globalmente vía npm
npm install -g @docmd/core

# O vía pnpm
pnpm add -g @docmd/core

# Ejecutar
docmd dev    # iniciar servidor de desarrollo
docmd build  # construir para despliegue
```

O ejecutar mediante Docker:

```bash
docker run -p 3000:3000 ghcr.io/docmd-io/docmd:0.9.0
```

> Fija una versión para compilaciones reproducibles.

</details>

## ¿Por qué docmd?

<div align="center">
  <img width="1000" alt="image" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-comparison.webp" />
</div>

<!--
| Característica | docmd | Docusaurus | MkDocs | VitePress | Mintlify |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Config. requerida** | **Ninguna** | `docusaurus.config.js` | `mkdocs.yml` | `config.mts` | `docs.json` |
| **Carga de JS** | **~18 kb** | ~250 kb | ~40 kb | ~50 kb | ~120 kb |
| **Navegación** | **SPA Instantánea** | React SPA | Recarga completa | Vue SPA | SPA Alojada |
| **Control de versiones** | **Nativo** | Nativo (complejo) | plugin mike | Manual | Nativo |
| **i18n** | **Nativo** | Nativo (complejo) | Basado en plugins | Nativo | Nativo |
| **Multiproyecto** | **Nativo** | Plugin | Plugin | - | - |
| **Búsqueda** | **Integrada** | Algolia (nube) | Integrada | MiniSearch | Nube |
| **Asistente de IA** | **Integrado — BYOK + Cloud Relay** | - | - | - | Integrado (Nube) |
| **Contexto de IA (`llms.txt`)** | **Integrado** | - | - | - | Integrado |
| **Servidor MCP** | **Integrado** | - | - | - | Integrado |
| **Agent Skills** | **Integrado** | - | - | - | - |
| **Imagen Docker** | **Oficial** | - | Oficial | - | - |
| **Autohospedado** | **Sí** | Sí | Sí | Sí | - |
| **Costo** | **Gratis (OSS)** | Gratis (OSS) | Gratis (OSS) | Gratis (OSS) | Freemium |
-->

**Vea la [Comparativa completa con Docusaurus, Mintlify y otros →](https://docs.docmd.io/es/comparison/)**

## Características

### Sin configuración, inicio instantáneo
Apunta docmd a cualquier carpeta con Markdown y funcionará. La navegación se genera automáticamente a partir de tu estructura de archivos. Puedes escribir tu primer documento y ponerlo en línea en menos de un minuto — sin código base repetitivo, sin canalización de compilación que configurar, sin decisiones previas.

### Diminuto por defecto, rápido en todas partes
Sin framework runtime — la salida es HTML estático y JavaScript vanilla mínimo. La navegación entre páginas funciona como una SPA instantánea. Optimizado para SEO, con mapa del sitio, URLs canónicas y metadatos de Open Graph incluidos. Búsqueda de texto completo sin conexión integrada, sin requerir servicios en la nube.

### Nativo de IA
docmd trata a la IA como una forma de primera clase para consumir documentación — sin reemplazar la documentación misma.
- **Asistente de IA (`@docmd/plugin-ai`)** — Chat basado en RAG ajustado a tu documentación. Usa tu propia clave de API o conecta un proveedor local de IA, compatible con más de 100 proveedores mediante AIPlug.
- **Cloud Relay** — habilita el Asistente de IA en documentación estática sin ejecutar tu propio backend de IA. [Pruébalo →](https://cloud.docmd.io)
- **Servidor MCP** — `docmd mcp` expone tus documentos a agentes de IA sobre stdio, permitiéndoles buscar, leer y validar contenido directamente.
- **Contexto (`llms.txt` / `llms-full.txt`)** — contexto de documentación completo generado en tiempo de compilación.
- **Agent Skills** — conjuntos de instrucciones modulares para LLMs y agentes de IDE.
- **Open Knowledge Format (OKF)** — paquetes de conocimiento estructurados y multilingües para sistemas de IA.
- **Copiar como Markdown / Copiar Contexto** — botones con un solo clic en el navegador, optimizados para pegar en chats de IA.

### Diseñado para escalar
- Internacionalización con compilaciones para múltiples idiomas (índice de búsqueda por idioma, llms, okf, hreflang)
- Gestión de versiones para múltiples entregas de documentación (con detección automática de la versión actual)
- Espacios de trabajo (Workspaces) para monorepositorios y proyectos múltiples
- Sistema de plugins para extender el comportamiento principal (validación del tipo de retorno por hook, compatible con código asíncrono)
- Soporte total de temas, plantillas integradas, CSS/JS personalizado, modo claro/oscuro

## CLI

```bash
docmd dev            # servidor de desarrollo local
docmd build          # construir para despliegue
docmd live           # Editor en Vivo basado en navegador
docmd init           # crear un docmd.config.json inicial en la carpeta actual
docmd stop           # detener cualquier servidor `docmd dev` / `docmd live` en ejecución
docmd doctor         # chequeo previo: estado de configuración e instalación de plugins
docmd migrate        # migrar a docmd desde Docusaurus, VitePress, MkDocs o Starlight
docmd deploy         # generar configuración para Docker, NGINX, Caddy, Vercel, Netlify
docmd validate       # verificar todos los enlaces internos
docmd mcp            # ejecutar como un servidor MCP sobre stdio
docmd add <nombre>   # instalar un plugin o plantilla
```

## Plugins

La funcionalidad principal funciona a través de un sistema de plugins robusto. Lo esencial está incluido por defecto, mientras que los plugins opcionales se pueden agregar para necesidades específicas.

| Plugin | Estado | Descripción |
| :--- | :---: | :--- |
| `ai` | Principal | Asistente de IA mediante RAG con soporte BYOK, proveedores locales y Cloud Relay |
| `search` | Principal | Búsqueda de texto completo sin conexión (palabras clave + semántica opcional vía `docmd-search`) |
| `seo` | Principal | Etiquetas SEO y metadatos Open Graph |
| `sitemap` | Principal | Genera `sitemap.xml` |
| `git` | Principal | Historial de commits de Git y fechas de última actualización |
| `analytics` | Principal | Integración ligera de analíticas |
| `llms` | Principal | Generación de contexto de IA (`llms.txt` / `llms-full.txt`) |
| `okf` | Principal | Paquetes Open Knowledge Format para agentes de IA (por idioma) |
| `mermaid` | Principal | Soporte para diagramas Mermaid |
| `openapi` | Principal | Renderizador de especificaciones OpenAPI 3.x en tiempo de compilación |
| `pwa` | Opcional | Aplicación Web Progresiva — navegación sin conexión |
| `threads` | Opcional | Hilos de discusión integrados *(por @svallory)* |
| `math` | Opcional | Renderizado de fórmulas matemáticas con KaTeX / LaTeX |

Instalar plugins opcionales:

```bash
docmd add <nombre-del-plugin>
```

Crea el tuyo: [Guía de Desarrollo de Plugins](https://docs.docmd.io/es/development/building-plugins/)

## Configuración

No se requiere configuración para comenzar. Agrega un `docmd.config.json` (o `.ts` / `.js`) en la raíz de tu proyecto solo cuando necesites más control:

```json
{
  "title": "Mi Proyecto",
  "url": "https://docs.miproyecto.com",
  "src": "./docs",
  "out": "./dist"
}
```

Los archivos de configuración TypeScript y JavaScript son compatibles para valores dinámicos.

Referencia completa: [Resumen de Configuración](https://docs.docmd.io/es/configuration/overview)

## Estructura del Proyecto

```text
mis-documentos/
├── docs/                ← Tus archivos markdown
├── assets/              ← Imágenes y archivos estáticos
├── docmd.config.json    ← Configuración opcional
└── package.json
```

## Editor en Vivo

Un editor basado en navegador para escribir y previsualizar documentación — sin necesidad de configuración local.

**Pruébalo en [live.docmd.io](https://live.docmd.io)**

## API Programática

Usa docmd en scripts de Node.js, canalizaciones de CI o pasos de compilación personalizados. (Soporta CommonJS y ESM).

```javascript
import { build } from '@docmd/core';

await build('./docmd.config.json', { isDev: false });
```

Referencia completa: [API de Node](https://docs.docmd.io/es/development/node-api-reference/)

## Comunidad

- **Bugs y problemas** → [Issues en GitHub](https://github.com/docmd-io/docmd/issues)
- **Preguntas e ideas** → [Discusiones](https://github.com/orgs/docmd-io/discussions)
- **Contribuir** → [CONTRIBUTING.md](.github/CONTRIBUTING.md)
- **Mapa de ruta** → [Discusiones en GitHub](https://github.com/orgs/docmd-io/discussions/2)

## Apoyo

- Dar a conocer el proyecto es la forma más directa de apoyar el desarrollo de docmd. [Compártelo en X](https://twitter.com/intent/tweet?url=https://github.com/docmd-io/docmd&text=docmd%20-%20Documentación%20lista%20para%20producción%20desde%20Markdown%20en%20segundos.) con amigos o dale una estrella.
- Si docmd te ahorra tiempo, un [patrocinio en GitHub](https://github.com/sponsors/mgks) ayuda enormemente.
- ¿Tienes ideas o errores que reportar? Abre un issue o un PR, y siéntete libre de contribuir con tus propios plugins.

## Licencia

Licencia MIT. Consulta [`LICENSE`](./LICENSE) para obtener más detalles.