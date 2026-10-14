<div align="right">
  <sup>
    <a href="./README.md">EN</a> &nbsp;|&nbsp; <a href="./README.de.md">DE</a> &nbsp;|&nbsp; <a href="./README.zh.md">中文</a> &nbsp;|&nbsp; <b>ES</b> &nbsp;|&nbsp; <a href="./README.ja.md">日本語</a> &nbsp;|&nbsp; <a href="./README.fr.md">FR</a> &nbsp;|&nbsp; <a href="./README.ru.md">RU</a> &nbsp;|&nbsp; <a href="./README.tr.md">TR</a>
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
    <b>Documentación para humanos y máquinas.</b><br/>
    Una fuente Markdown → sitio web, búsqueda, contexto de IA, agentes y formatos de conocimiento.
  </p>

  <p>
    <a href="https://www.npmjs.com/package/@docmd/core"><img src="https://img.shields.io/npm/v/@docmd/core.svg?style=flat-square&color=CB3837" alt="versión npm"></a>
    <a href="https://www.npmjs.com/package/@docmd/core?activeTab=versions"><img src="https://img.shields.io/npm/dm/@docmd/core.svg?style=flat-square&color=38bd24" alt="descargas mensuales"></a>
    <a href="https://github.com/docmd-io/docmd"><img src="https://img.shields.io/github/stars/docmd-io/docmd?style=flat-square&logo=github" alt="estrellas en GitHub"></a>
    <a href="https://github.com/docmd-io/docmd/blob/main/LICENSE"><img src="https://img.shields.io/github/license/docmd-io/docmd.svg?style=flat-square&color=A31F34" alt="licencia"></a>
  </p>

  <h4>
    <a href="https://docmd.io">Sitio web</a> &nbsp;·&nbsp;
    <a href="https://docs.docmd.io">Documentación</a> &nbsp;·&nbsp;
    <a href="https://cloud.docmd.io">Cloud Relay</a> &nbsp;·&nbsp;
    <a href="https://live.docmd.io">Editor en vivo</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd-skills">Agent Skills</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd/issues">Issues</a>
  </h4>

  <br/>

  <a href="https://docmd.io">
    <img width="820" alt="Documentación de docmd — vista previa en modo claro y oscuro" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-cover.webp" />
  </a>

</div>

## Inicio rápido

Apunta docmd a una carpeta de archivos Markdown:

```bash
npx @docmd/core dev
```

Abre `http://localhost:3000`.

Eso es todo. La navegación se genera automáticamente a partir de la estructura de tus archivos. Sin archivos de configuración, frontmatter ni frameworks requeridos.

Cuando estés listo para desplegar:

```bash
npx @docmd/core build
```

docmd genera un sitio estático que se puede desplegar en Vercel, Cloudflare Pages, Netlify, GitHub Pages, S3, NGINX, Caddy o cualquier otro alojamiento estático.

**Requiere Node.js 20+.**

<details>
  <summary><b>Instalación global y Docker</b></summary>

<br/>

Instalar globalmente:

```bash
npm install -g @docmd/core

# o
pnpm add -g @docmd/core
```

Luego:

```bash
docmd dev
docmd build
```

O ejecutar con Docker:

```bash
docker run -p 3000:3000 ghcr.io/docmd-io/docmd:latest
```

> Fija la imagen de Docker a una versión específica para compilaciones reproducibles en producción.

</details>

## Una fuente. Cada resultado.

docmd es un compilador de documentación de código abierto.

En lugar de tratar tu Markdown únicamente como entrada para un sitio web, docmd compila la misma fuente en resultados para lectores, motores de búsqueda, LLMs, agentes de codificación y sistemas de conocimiento.

```text
Markdown
   │
   ▼
 docmd
   │
   ├── → Sitio de documentación estática
   ├── → Índice de búsqueda sin conexión
   ├── → llms.txt / llms-full.txt
   ├── → Open Knowledge Format (OKF)
   ├── → Mapa del sitio + metadatos SEO
   ├── → robots.txt + Open Graph
   ├── → Interfaz MCP para agentes de IA
   └── → Contexto del Asistente de IA
```

Un solo árbol de fuentes. Una sola canalización de compilación. Sin stacks de documentación y conocimiento de IA separados que mantener.

## ¿Por qué docmd?

La documentación tiene cada vez más de un tipo de lector.

Las personas necesitan un sitio web rápido y fácil de navegar. Los motores de búsqueda necesitan metadatos estructurados. Los LLMs necesitan contexto limpio. Los agentes de codificación necesitan herramientas y protocolos. Los sistemas RAG necesitan conocimiento estructurado.

docmd construye todo esto en conjunto manteniendo a Markdown en el centro.

<a href="https://docs.docmd.io/comparison/">
  <img width="800" alt="Comparativa de docmd con otras herramientas de documentación" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-comparison.webp" />
</a>
<br/>
<b>Ver la comparativa completa con <a href="https://docs.docmd.io/comparison/">Docusaurus, Mintlify y otras herramientas de documentación →</a></b>

## Características

### Cero configuración, inicio instantáneo

Apunta docmd a cualquier carpeta con Markdown y funcionará. La navegación se genera automáticamente a partir de la estructura de tus archivos — sin código repetitivo, frontmatter ni canalización de compilación requerida para comenzar.

### Ligero por defecto, rápido en todas partes

docmd genera HTML estático con un mínimo de JavaScript vanilla y navegación rápida estilo SPA. Búsqueda de texto completo sin conexión, mapa del sitio, URLs canónicas, metadatos Open Graph y otros elementos esenciales vienen integrados en el resultado.

### Preparado para IA y agentes

docmd trata la documentación legible por máquinas como parte de la compilación, no como un flujo de publicación separado.

* **Asistente de IA** — Chat basado en RAG conectado con tu documentación
* **Servidor MCP** — permite a los agentes de código compatibles buscar, leer y validar tus documentos
* **`llms.txt` / `llms-full.txt`** — contexto completo de documentación legible por LLMs
* **Open Knowledge Format (OKF)** — paquetes estructurados de conocimiento para sistemas de IA y RAG
* **Agent Skills** — instrucciones reutilizables para LLMs y agentes de codificación
* **Copiar como Markdown / Copiar contexto** — extracción de contexto limpio directamente desde el navegador
* **Búsqueda semántica** — recuperación vectorial opcional junto con la búsqueda por palabras clave integrada

### Diseñado para escalar

* Internacionalización con búsqueda localizada y salidas generadas por idioma
* Control de versiones para múltiples versiones de documentación
* Espacios de trabajo (Workspaces) para monorepositorios y configuraciones multiproyecto
* Renderizado de OpenAPI 3.x para documentación de APIs
* Plantillas integradas, CSS/JavaScript personalizado y modo claro/oscuro

## Asistente de IA y Cloud Relay

docmd incluye un Asistente de IA basado en RAG conectado con tu documentación.

Puedes conectarlo a tu propio backend o a un proveedor local de IA. Si tu documentación está desplegada como sitio estático, **docmd Cloud Relay** proporciona el puente alojado en su lugar.

```text
Tu documentación
        │
        ▼
 @docmd/plugin-ai
        │
        ▼
 docmd Cloud Relay
        │
        ▼
 Tu proveedor de IA
```

Cloud Relay envía de forma segura las solicitudes de IA al proveedor que elijas, por lo que las credenciales del proveedor no necesitan enviarse al navegador y no tienes que operar un backend de IA.

**Cloud Relay es gratuito para usar con tu propia clave de proveedor de IA.**

* Trae tu propio proveedor y modelo
* Mantén las credenciales del proveedor fuera del cliente
* Funciona con alojamiento estático
* Sin backend de IA que desplegar o mantener
* Visibilidad de uso e información sobre las preguntas de los lectores
* Conecta múltiples proyectos de documentación desde una sola cuenta

**[Configurar Cloud Relay →](https://cloud.docmd.io)** • [Documentación del Asistente de IA →](https://docs.docmd.io/guides/ai/ai-assistant/)

> Cloud Relay es gratuito. El uso del modelo puede ser cobrado por separado por tu proveedor de IA elegido.

## CLI

```bash
docmd dev            # Iniciar el servidor de desarrollo local
docmd build          # Compilar para producción
docmd live           # Iniciar el Editor en Vivo basado en navegador
docmd init           # Crear un archivo de configuración
docmd doctor         # Comprobar la configuración y el estado de los plugins
docmd validate       # Comprobar enlaces internos de la documentación
docmd migrate        # Migrar desde Docusaurus, VitePress, MkDocs o Starlight
docmd deploy         # Generar configuración de despliegue
docmd mcp            # Ejecutar el servidor MCP sobre stdio
docmd add <name>     # Instalar un plugin o plantilla
docmd stop           # Detener servidores de desarrollo docmd en ejecución
```

**Ver todos los [Comandos de la CLI →](https://docs.docmd.io/reference/cli-commands/)**

## Plugins

docmd se basa en un sistema de plugins. Las capacidades comunes de documentación vienen incluidas con el core, mientras que los plugins opcionales se pueden instalar según sea necesario.

| Plugin      |  Estado   | Descripción                                                          |
| :---------- | :-------: | :------------------------------------------------------------------- |
| `ai`        | Principal | Asistente de IA mediante RAG con BYOK, proveedores locales y Cloud Relay |
| `search`    | Principal | Búsqueda por palabras clave sin conexión con búsqueda semántica opcional |
| `seo`       | Principal | Metadatos SEO y Open Graph                                           |
| `sitemap`   | Principal | Genera `sitemap.xml`                                                 |
| `git`       | Principal | Historial de Git y metadatos de última actualización                 |
| `analytics` | Principal | Integración ligera de analíticas                                     |
| `llms`      | Principal | Genera `llms.txt` y `llms-full.txt`                                  |
| `okf`       | Principal | Paquetes de Open Knowledge Format                                    |
| `mermaid`   | Principal | Renderizado de diagramas Mermaid                                     |
| `openapi`   | Principal | Renderizador de documentación OpenAPI 3.x                            |
| `pwa`       | Opcional  | Progressive Web App y navegación sin conexión                        |
| `threads`   | Opcional  | Hilos de discusión en la documentación *(por @svallory)*             |
| `math`      | Opcional  | Renderizado de fórmulas KaTeX / LaTeX                                |

Instalar un plugin opcional:

```bash
docmd add <plugin-name>
```

**Crea el tuyo propio: [Guía de desarrollo de plugins →](https://docs.docmd.io/development/building-plugins/)**

## Configuración

La configuración es opcional.

Agrega un archivo `docmd.config.json`, `docmd.config.ts` o `docmd.config.js` en la raíz de tu proyecto cuando necesites más control:

```json
{
  "title": "Mi Proyecto",
  "url": "https://docs.miproyecto.com",
  "src": "./docs",
  "out": "./dist"
}
```

Se pueden usar configuraciones en TypeScript y JavaScript cuando se requieran valores dinámicos.

**[Referencia de configuración →](https://docs.docmd.io/configuration/overview)**

## API programática

Usa docmd desde scripts de Node.js, canalizaciones de CI o sistemas de compilación personalizados.

```javascript
import { build } from '@docmd/core';

// Compilar documentación mediante programación.
await build('./docmd.config.json', { isDev: false });
```

Soporta CommonJS y ESM.

**[Referencia de la API de Node →](https://docs.docmd.io/development/node-api-reference/)**

## Migración

La documentación existente no necesita empezar desde cero.

```bash
docmd migrate
```

Hay herramientas de migración disponibles para los frameworks de documentación compatibles, incluidos Docusaurus, VitePress, MkDocs y Starlight.

**[Documentación de migración →](https://docs.docmd.io)**

## Código abierto

Tu documentación es el núcleo intelectual de tu proyecto. Pertenece a archivos Markdown simples en tu repositorio Git: portátil, con control de versiones y auditable.

**El compilador docmd y los plugins oficiales de core tienen licencia MIT y seguirán siendo de uso gratuito, sin características del compilador detrás de un muro de pago.**

La documentación generada se puede alojar en cualquier lugar y no requiere infraestructura alojada por docmd.

## Comunidad

* **Documentación** → [docs.docmd.io](https://docs.docmd.io)
* **Preguntas e ideas** → [GitHub Discussions](https://github.com/orgs/docmd-io/discussions)
* **Bugs y solicitudes de funciones** → [GitHub Issues](https://github.com/docmd-io/docmd/issues)
* **Contribuir** → [CONTRIBUTING.md](.github/CONTRIBUTING.md)
* **Mapa de ruta** → [GitHub Discussions](https://github.com/orgs/docmd-io/discussions/2)

## Apoya a docmd

Si docmd te resulta útil:

* Dale al repositorio una ⭐
* Compártelo con alguien que esté creando documentación
* Abre issues, contribuye con soluciones o crea un plugin
* [Patrocina el desarrollo en GitHub](https://github.com/sponsors/mgks)

## Licencia

Licencia MIT. Consulta [LICENSE](LICENSE) para más detalles.