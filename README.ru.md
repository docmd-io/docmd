<div align="right">
  <sup>
    <a href="./README.md">EN</a> &nbsp;|&nbsp; <a href="./README.de.md">DE</a> &nbsp;|&nbsp; <a href="./README.zh.md">中文</a> &nbsp;|&nbsp; <a href="./README.es.md">ES</a> &nbsp;|&nbsp; <a href="./README.ja.md">日本語</a> &nbsp;|&nbsp; <a href="./README.fr.md">FR</a> &nbsp;|&nbsp; <b>RU</b>
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

  <p><b>Документация для людей и машин.</b><br/>Один источник Markdown → веб-сайт, поиск, AI-контекст и протоколы агентов. Всё генерируется вместе.</p>

  <p>
    <a href="https://www.npmjs.com/package/@docmd/core"><img src="https://img.shields.io/npm/v/@docmd/core.svg?style=flat-square&color=CB3837" alt="npm версия"></a>
    <a href="https://www.npmjs.com/package/@docmd/core?activeTab=versions"><img src="https://img.shields.io/npm/dm/@docmd/core.svg?style=flat-square&color=38bd24" alt="скачивания в месяц"></a>
    <a href="https://github.com/docmd-io/docmd"><img src="https://img.shields.io/github/stars/docmd-io/docmd?style=flat-square&logo=github" alt="GitHub звезд"></a>
    <a href="https://github.com/docmd-io/docmd/blob/main/LICENSE"><img src="https://img.shields.io/github/license/docmd-io/docmd.svg?style=flat-square&color=A31F34" alt="лицензия"></a>
  </p>

  <h4>
    <a href="https://docmd.io">Веб-сайт</a> &nbsp;·&nbsp;
    <a href="https://docs.docmd.io">Документация</a> &nbsp;·&nbsp;
    <a href="https://cloud.docmd.io">AI Cloud Relay</a> &nbsp;·&nbsp;
    <a href="https://live.docmd.io">Онлайн-редактор</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd-skills">Agent Skills</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd/issues">Сообщить об ошибке</a>
  </h4>

  <br/>

  <a href="https://docs.docmd.io">
    <img width="820" alt="Тема по умолчанию docmd — предпросмотр светлого и темного режимов" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-cover.webp" />
  </a>

  <br/><br/>

</div>

> ## ✦ 0.9 Серия — ИИ, Автоматизация и Безопасность
>
> Линейка 0.9.x — это этап, на котором docmd эволюционирует из генератора документации,
> готового к ИИ, в полноценную платформу документации, разработанную как для **людей,
> так и для ИИ-агентов**.
>
> В этой серии представлен **ИИ-ассистент**, позволяющий вести диалоговый поиск
> по документации с использованием собственного провайдера, локального ИИ или
> **docmd Cloud Relay** для статических сайтов без собственного бэкенда.
> Также расширяется ИИ-экосистема docmd благодаря поддержке MCP, сгенерированному
> контексту для LLM, Agent Skills и структурированным форматам знаний.
>
> Наряду с ИИ, особое внимание уделяется **безопасности, конфиденциальности и автоматизации**,
> параллельно с непрерывным улучшением основных функций работы с документацией, поиска,
> развертывания и рабочих процессов разработчиков.
>
> [Следить за дорожной картой 0.9 →](https://github.com/orgs/docmd-io/discussions/10)

## Быстрый старт

Запустите docmd в любой папке с Markdown-файлами — установка не требуется:

```bash
npx @docmd/core dev
```

<details>
  <summary><b>Открывается по адресу <code>http://localhost:3000</code></b></summary><br>

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

Навигация генерируется автоматически на основе структуры ваших файлов. Не требуется файл конфигурации, frontmatter или изучение сложных фреймворков.

**Когда будете готовы к публикации:**

```bash
npx @docmd/core build
```

Команда сгенерирует высокооптимизированный статический сайт (SPA), готовый к деплою на Vercel, Cloudflare Pages, Netlify, GitHub Pages или любой статический хостинг.

**Требования:** Node.js 18+

<details>
  <summary><b>Или установите глобально / через Docker</b></summary><br/>

```bash
# Установка глобально через npm
npm install -g @docmd/core

# Или через pnpm
pnpm add -g @docmd/core

# Запуск
docmd dev    # запуск сервера разработки
docmd build  # сборка для продакшена
```

Или запуск через Docker:

```bash
docker run -p 3000:3000 ghcr.io/docmd-io/docmd:0.9.0
```

> Зафиксируйте версию для воспроизводимых сборок.

</details>

## Почему docmd?

<div align="center">
  <img width="1000" alt="image" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-comparison.webp" />
</div>

<!--
| Возможность | docmd | Docusaurus | MkDocs | VitePress | Mintlify |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Обязательный конфиг** | **Нет** | `docusaurus.config.js` | `mkdocs.yml` | `config.mts` | `docs.json` |
| **Размер JS** | **~18 kb** | ~250 kb | ~40 kb | ~50 kb | ~120 kb |
| **Переходы страниц** | **Мгновенный SPA** | React SPA | Полная перезагрузка | Vue SPA | Облачный SPA |
| **Версионирование** | **Нативное** | Нативное (сложное) | плагин mike | Вручную | Нативное |
| **Мультиязычность (i18n)** | **Нативная** | Нативная (сложная) | На плагинах | Нативная | Нативная |
| **Мультипроекты** | **Нативные** | Плагин | Плагин | - | - |
| **Поиск** | **Встроенный** | Algolia (облако) | Встроенный | MiniSearch | Облако |
| **ИИ-ассистент** | **Встроенный — BYOK + Cloud Relay** | - | - | - | Встроенный (Облако) |
| **Контекст ИИ (`llms.txt`)** | **Встроенный** | - | - | - | Встроенный |
| **Сервер MCP** | **Встроенный** | - | - | - | Встроенный |
| **Agent Skills** | **Встроенные** | - | - | - | - |
| **Docker-образ** | **Официальный** | - | Официальный | - | - |
| **Self-hosted** | **Да** | Да | Да | Да | - |
| **Стоимость** | **Бесплатно (OSS)** | Бесплатно (OSS) | Бесплатно (OSS) | Бесплатно (OSS) | Freemium |
-->

**Смотрите полное [Сравнение с Docusaurus, Mintlify и другими →](https://docs.docmd.io/comparison/)**

## Особенности

### Нулевая конфигурация, мгновенный запуск
Укажите docmd на любую папку с Markdown-файлами, и он сразу заработает. Навигация формируется автоматически из структуры файлов. Вы можете написать первый документ и опубликовать его менее чем за минуту — без шаблонов, настройки сборок и предварительных решений.

### Минимальный размер, скорость везде
Размер основного JavaScript-кода составляет всего ~18 кб. Страницы переключаются как мгновенное SPA-приложение. На выходе получается статический HTML — оптимизированный для SEO, со встроенными sitemap, каноническими URL и метаданными Open Graph. Офлайн полнотекстовый поиск встроен по умолчанию и не требует сторонних сервисов.

### Нативно для ИИ
docmd рассматривает ИИ как первоклассный способ работы с документацией, не заменяя при этом саму документацию.
- **ИИ-ассистент (`@docmd/plugin-ai`)** — RAG-чат по вашей документации. Используйте свой API-ключ или подключайте локального ИИ-провайдера благодаря поддержке 100+ сервисов через AIPlug.
- **Cloud Relay** — включайте ИИ-ассистента на статических сайтах без развертывания собственного ИИ-бэкенда. [Попробовать →](https://cloud.docmd.io)
- **Сервер MCP** — `docmd mcp` предоставляет доступ к документации для ИИ-агентов через stdio, позволяя им искать, читать и проверять содержимое.
- **Контекст (`llms.txt` / `llms-full.txt`)** — полный контекст документации, генерируемый во время сборки.
- **Agent Skills** — модульные наборы инструкций для LLM и агентов IDE.
- **Open Knowledge Format (OKF)** — структурированные многоязычные пакеты знаний для ИИ-систем.
- **Копировать как Markdown / Копировать контекст** — кнопки извлечения контекста в один клик прямо из браузера.

### Готов к масштабированию
- Мультиязычность с многоязычной сборкой (индивидуальный индекс поиска для каждого языка, llms, okf, hreflang)
- Версионирование документации (с автоматическим определением текущей версии)
- Workspaces для монорепозиториев и мультипроектных структур
- Гибкая система плагинов (проверка типов возвращаемых значений, поддержка async)
- Кастомизация тем, встроенные шаблоны, собственные CSS/JS, светлый и темный режимы

## CLI

```bash
docmd dev            # локальный сервер разработки
docmd build          # сборка для деплоя
docmd live           # запуск онлайн-редактора в браузере
docmd init           # создание docmd.config.json в текущей папке
docmd stop           # остановка серверов `docmd dev` / `docmd live`
docmd doctor         # диагностика конфигурации и статуса плагинов
docmd migrate        # миграция с Docusaurus, VitePress, MkDocs или Starlight
docmd deploy         # генерация конфигов для Docker, NGINX, Caddy, Vercel, Netlify
docmd validate       # проверка всех внутренних ссылок и якорей
docmd mcp            # запуск сервера MCP через stdio
docmd add <name>     # установка плагина или шаблона
```

## Плагины

Базовый функционал работает на основе мощной системы плагинов. Основные модули включены по умолчанию, а дополнительные устанавливаются по мере необходимости.

| Плагин | Статус | Описание |
| :--- | :---: | :--- |
| `ai` | Базовый | RAG ИИ-ассистент с поддержкой BYOK, локальных провайдеров и Cloud Relay |
| `search` | Базовый | Офлайн полнотекстовый поиск (ключевые слова + семантический через `docmd-search`) |
| `seo` | Базовый | SEO-теги и метаданные Open Graph |
| `sitemap` | Базовый | Генерация `sitemap.xml` |
| `git` | Базовый | История коммитов Git и даты последнего обновления |
| `analytics` | Базовый | Легкая аналитика посещаемости |
| `llms` | Базовый | Генерация контекста для ИИ (`llms.txt` / `llms-full.txt`) |
| `okf` | Базовый | Пакеты Open Knowledge Format для ИИ-агентов (по языкам) |
| `mermaid` | Базовый | Поддержка диаграмм Mermaid |
| `openapi` | Базовый | Рендерер спецификаций OpenAPI 3.x во время сборки |
| `pwa` | Опциональный | Progressive Web App — офлайн навигация |
| `threads` | Опциональный | Встроенные ветки обсуждений *(от @svallory)* |
| `math` | Опциональный | Рендеринг математических формул KaTeX / LaTeX |

Установка опциональных плагинов:

```bash
docmd add <имя-плагина>
```

Создание собственного плагина: [Руководство по разработке плагинов](https://docs.docmd.io/development/building-plugins/)

## Конфигурация

Конфигурация не требуется для старта. Добавьте `docmd.config.json` (или `.ts` / `.js`) в корень проекта только тогда, когда потребуется точная настройка:

```json
{
  "title": "Мой Проект",
  "url": "https://docs.myproject.com",
  "src": "./docs",
  "out": "./dist"
}
```

Конфигурационные файлы на TypeScript и JavaScript поддерживаются для динамических значений.

Полный справочник: [Обзор конфигурации](https://docs.docmd.io/configuration/overview)

## Структура проекта

```text
my-docs/
├── docs/                ← Ваши файлы markdown
├── assets/              ← Изображения и статические файлы
├── docmd.config.json    ← Опциональная конфигурация
└── package.json
```

## Онлайн-редактор (Live Editor)

Редактор в браузере для написания и предпросмотра документов — локальная установка не требуется.

**Попробуйте на [live.docmd.io](https://live.docmd.io)**

## Программный API

Используйте docmd в скриптах Node.js, пайплайнах CI или кастомных шагах сборки. (Поддерживает CommonJS и ESM).

```javascript
import { build } from '@docmd/core';

await build('./docmd.config.json', { isDev: false });
```

Полный справочник: [Node API Reference](https://docs.docmd.io/development/node-api-reference/)

## Сообщество

- **Ошибки и баги** → [GitHub Issues](https://github.com/docmd-io/docmd/issues)
- **Вопросы и идеи** → [Discussions](https://github.com/orgs/docmd-io/discussions)
- **Участие в разработке** → [CONTRIBUTING.md](.github/CONTRIBUTING.md)
- **Дорожная карта** → [GitHub Discussions](https://github.com/orgs/docmd-io/discussions/2)

## Поддержка

- Рассказать о проекте — лучший способ поддержать развитие docmd. [Поделитесь в X](https://twitter.com/intent/tweet?url=https://github.com/docmd-io/docmd&text=docmd%20-%20Готовая%20к%20продакшену%20документация%20из%20Markdown%20за%20считанные%20секунды.) с друзьями или поставьте звезду репозиторию.
- Если docmd экономит ваше время, [спонсорство на GitHub](https://github.com/sponsors/mgks) будет огромной помощью.
- Есть идеи или нашли баг? Открывайте issue или PR, а также создавайте собственные плагины.

## Лицензия

Лицензия MIT. Смотрите файл [`LICENSE`](./LICENSE) для подробностей.
