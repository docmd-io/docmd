<div align="right">
  <sup>
    <a href="./README.md">EN</a> &nbsp;|&nbsp; <a href="./README.de.md">DE</a> &nbsp;|&nbsp; <a href="./README.zh.md">中文</a> &nbsp;|&nbsp; <a href="./README.es.md">ES</a> &nbsp;|&nbsp; <a href="./README.ja.md">日本語</a> &nbsp;|&nbsp; <a href="./README.fr.md">FR</a> &nbsp;|&nbsp; <b>RU</b> &nbsp;|&nbsp; <a href="./README.tr.md">TR</a>
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
    <b>Документация для людей и машин.</b><br/>
    Один источник Markdown → веб-сайт, поиск, AI-контекст, агенты и форматы знаний.
  </p>

  <p>
    <a href="https://www.npmjs.com/package/@docmd/core"><img src="https://img.shields.io/npm/v/@docmd/core.svg?style=flat-square&color=CB3837" alt="npm версия"></a>
    <a href="https://www.npmjs.com/package/@docmd/core?activeTab=versions"><img src="https://img.shields.io/npm/dm/@docmd/core.svg?style=flat-square&color=38bd24" alt="скачивания в месяц"></a>
    <a href="https://github.com/docmd-io/docmd"><img src="https://img.shields.io/github/stars/docmd-io/docmd?style=flat-square&logo=github" alt="GitHub звезд"></a>
    <a href="https://github.com/docmd-io/docmd/blob/main/LICENSE"><img src="https://img.shields.io/github/license/docmd-io/docmd.svg?style=flat-square&color=A31F34" alt="лицензия"></a>
  </p>

  <h4>
    <a href="https://docmd.io">Веб-сайт</a> &nbsp;·&nbsp;
    <a href="https://docs.docmd.io">Документация</a> &nbsp;·&nbsp;
    <a href="https://cloud.docmd.io">Cloud Relay</a> &nbsp;·&nbsp;
    <a href="https://live.docmd.io">Онлайн-редактор</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd-skills">Agent Skills</a> &nbsp;·&nbsp;
    <a href="https://github.com/docmd-io/docmd/issues">Issues</a>
  </h4>

  <br/>

  <a href="https://docmd.io">
    <img width="820" alt="Документация docmd — превью в светлом и темном режимах" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-cover.webp" />
  </a>

</div>

## Быстрый старт

Укажите docmd на папку с Markdown-файлами:

```bash
npx @docmd/core dev
```

Откройте `http://localhost:3000`.

Вот и всё. Навигация формируется автоматически из структуры файлов. Без файлов конфигурации, frontmatter или фреймворков.

Когда вы будете готовы к развертыванию:

```bash
npx @docmd/core build
```

docmd генерирует статический сайт, который можно развернуть на Vercel, Cloudflare Pages, Netlify, GitHub Pages, S3, NGINX, Caddy или любом другом статическом хостинге.

**Требуется Node.js 20+.**

<details>
  <summary><b>Глобальная установка и Docker</b></summary>

<br/>

Установить глобально:

```bash
npm install -g @docmd/core

# или
pnpm add -g @docmd/core
```

Затем:

```bash
docmd dev
docmd build
```

Или запустите через Docker:

```bash
docker run -p 3000:3000 ghcr.io/docmd-io/docmd:latest
```

> Зафиксируйте версию Docker-образа на конкретном релизе для воспроизводимых продакшен-сборок.

</details>

## Один источник. Любой формат на выходе.

docmd — это компилятор документации с открытым исходным кодом.

Вместо того чтобы рассматривать Markdown лишь как исходник для сайта, docmd компилирует один и тот же источник в форматы для читателей, поисковых систем, LLM, агентных систем разработки и баз знаний.

```text
Markdown
   │
   ▼
 docmd
   │
   ├── → Статический сайт документации
   ├── → Офлайн-индекс поиска
   ├── → llms.txt / llms-full.txt
   ├── → Open Knowledge Format (OKF)
   ├── → Sitemap + SEO-метаданные
   ├── → robots.txt + Open Graph
   ├── → MCP-интерфейс для ИИ-агентов
   └── → Контекст для ИИ-ассистента
```

Одно дерево исходников. Один пайплайн сборки. Больше не нужно поддерживать раздельные стеки для документации и ИИ-знаний.

## Почему docmd?

У современной документации всё чаще бывает больше одного читателя.

Людям нужен быстрый и удобный сайт. Поисковым системам нужны структурированные метаданные. LLM нужен чистый контекст. Агентам для написания кода нужны инструменты и протоколы. RAG-системам нужны структурированные знания.

docmd объединяет всё это вместе, сохраняя Markdown в качестве единого центра.

<a href="https://docs.docmd.io/comparison/">
  <img width="800" alt="Сравнение docmd с другими инструментами документации" src="https://raw.githubusercontent.com/docmd-io/docmd/refs/heads/main/assets/docmd-comparison.webp" />
</a>
<br/>
<b>Смотрите полное сравнение с <a href="https://docs.docmd.io/comparison/">Docusaurus, Mintlify и другими инструментами документации →</a></b>

## Возможности

### Нулевая конфигурация, мгновенный запуск

Укажите docmd на любую папку с Markdown-файлами, и он сразу запустится. Навигация создается автоматически на основе структуры файлов — без шаблонного кода, frontmatter или настройки сборки.

### Легковесный по умолчанию, быстрый везде

docmd генерирует статический HTML с минимальным объемом чистого JavaScript и быстрой навигацией в стиле SPA. Офлайн-полнотекстовый поиск, sitemap, канонические URL, метаданные Open Graph и другие важные элементы встроены в результат сборки.

### Готовность к ИИ и агентам

docmd рассматривает машиночитаемую документацию как часть процесса сборки, а не как отдельный рабочий процесс публикации.

* **ИИ-ассистент** — RAG-чат, основанный на вашей документации
* **MCP-сервер** — позволяет совместимым агентам для разработки искать, читать и валидировать вашу документацию
* **`llms.txt` / `llms-full.txt`** — полный контекст документации для чтения LLM
* **Open Knowledge Format (OKF)** — структурированные пакеты знаний для ИИ и RAG-систем
* **Agent Skills** — переиспользуемые инструкции для LLM и агентов разработки
* **Копировать как Markdown / Копировать контекст** — чистое извлечение контекста прямо из браузера
* **Семантический поиск** — опциональный векторный поиск наряду со встроенным поиском по ключевым словам

### Создан для масштабирования

* Интернационализация с учетом локали для поиска и сгенерированных форматов
* Версионирование для нескольких релизов документации
* Workspaces для монорепозиториев и мультипроектных структур
* Рендеринг OpenAPI 3.x для документации API
* Встроенные шаблоны, кастомные CSS/JavaScript, светлая и темная темы

## ИИ-ассистент и Cloud Relay

docmd включает в себя RAG-ассистента на базе ИИ, который опирается на вашу документацию.

Вы можете подключить его к собственному бэкенду или локальному ИИ-провайдеру. Если ваша документация развернута как статический сайт, **docmd Cloud Relay** предоставит готовый облачный мост.

```text
Ваша документация
        │
        ▼
 @docmd/plugin-ai
        │
        ▼
 docmd Cloud Relay
        │
        ▼
 Ваш ИИ-провайдер
```

Cloud Relay безопасно отправляет запросы выбранному вами провайдеру, поэтому учетные данные провайдера не попадают в браузер, а вам не требуется развертывать собственный ИИ-бэкенд.

**Cloud Relay бесплатен при использовании собственного API-ключа провайдера.**

* Подключайте собственного провайдера и модель
* Учетные данные провайдера не передаются клиенту
* Работает со статическим хостингом
* Не требует развертывания и поддержки собственного ИИ-бэкенда
* Просматривайте статистику использования и вопросы читателей
* Подключайте несколько проектов документации из одного аккаунта

**[Настроить Cloud Relay →](https://cloud.docmd.io)** • [Документация по ИИ-ассистенту →](https://docs.docmd.io/guides/ai/ai-assistant/)

> Сервис Cloud Relay бесплатен. Использование моделей тарифицируется отдельно выбранным вами ИИ-провайдером.

## CLI

```bash
docmd dev            # Запуск локального сервера разработки
docmd build          # Сборка для продакшена
docmd live           # Запуск браузерного онлайн-редактора
docmd init           # Создать файл конфигурации
docmd doctor         # Проверить конфигурацию и статус плагинов
docmd validate       # Проверить внутренние ссылки документации
docmd migrate        # Миграция с Docusaurus, VitePress, MkDocs или Starlight
docmd deploy         # Сгенерировать конфигурацию развертывания
docmd mcp            # Запустить сервер MCP через stdio
docmd add <name>     # Установить плагин или шаблон
docmd stop           # Остановить запущенные серверы разработки docmd
```

**Смотрите полный список [Команд CLI →](https://docs.docmd.io/reference/cli-commands/)**

## Плагины

docmd построен на основе системы плагинов. Основные возможности работы с документацией поставляются в составе ядра, а опциональные плагины можно устанавливать по мере необходимости.

| Плагин      |    Статус    | Описание                                                             |
| :---------- | :----------: | :------------------------------------------------------------------- |
| `ai`        |   Базовый    | RAG ИИ-ассистент с поддержкой BYOK, локальных провайдеров и Cloud Relay |
| `search`    |   Базовый    | Офлайн-поиск по ключевым словам с опциональным семантическим поиском |
| `seo`       |   Базовый    | SEO и метаданные Open Graph                                          |
| `sitemap`   |   Базовый    | Генерация `sitemap.xml`                                              |
| `git`       |   Базовый    | История Git и метаданные о последнем обновлении                      |
| `analytics` |   Базовый    | Легковесная интеграция веб-аналитики                                 |
| `llms`      |   Базовый    | Генерация `llms.txt` и `llms-full.txt`                               |
| `okf`       |   Базовый    | Пакеты Open Knowledge Format                                         |
| `mermaid`   |   Базовый    | Рендеринг диаграмм Mermaid                                           |
| `openapi`   |   Базовый    | Рендерер документации OpenAPI 3.x                                    |
| `pwa`       | Опциональный | Progressive Web App и офлайн-навигация                               |
| `threads`   | Опциональный | Встроенные ветки обсуждений в документации *(от @svallory)*          |
| `math`      | Опциональный | Рендеринг формул KaTeX / LaTeX                                       |

Установка опционального плагина:

```bash
docmd add <plugin-name>
```

**Создайте собственный: [Руководство по разработке плагинов →](https://docs.docmd.io/development/building-plugins/)**

## Конфигурация

Конфигурация опциональна.

Добавьте `docmd.config.json`, `docmd.config.ts` или `docmd.config.js` в корень проекта, когда вам понадобится больше контроля:

```json
{
  "title": "Мой Проект",
  "url": "https://docs.myproject.com",
  "src": "./docs",
  "out": "./dist"
}
```

Конфигурации на TypeScript и JavaScript можно использовать, когда требуются динамические значения.

**[Справочник по конфигурации →](https://docs.docmd.io/configuration/overview)**

## Программный API

Используйте docmd в скриптах Node.js, пайплайнах CI или собственных системах сборки.

```javascript
import { build } from '@docmd/core';

// Программная сборка документации.
await build('./docmd.config.json', { isDev: false });
```

Поддерживаются CommonJS и ESM.

**[Справочник по Node API →](https://docs.docmd.io/development/node-api-reference/)**

## Миграция

Существующую документацию не нужно переписывать с нуля.

```bash
docmd migrate
```

Инструменты миграции доступны для поддерживаемых фреймворков документации, включая Docusaurus, VitePress, MkDocs и Starlight.

**[Документация по миграции →](https://docs.docmd.io)**

## Открытый исходный код

Документация — это интеллектуальное сердце вашего проекта. Ей самое место в простых файлах Markdown в вашем Git-репозитории: переносимой, версионируемой и прозрачной.

**Компилятор docmd и официальные базовые плагины распространяются под лицензией MIT и останутся бесплатными, без каких-либо платных функций в компиляторе.**

Сгенерированная документация может быть размещена где угодно и не требует собственной инфраструктуры docmd.

## Сообщество

* **Документация** → [docs.docmd.io](https://docs.docmd.io)
* **Вопросы и идеи** → [GitHub Discussions](https://github.com/orgs/docmd-io/discussions)
* **Ошибки и предложения** → [GitHub Issues](https://github.com/docmd-io/docmd/issues)
* **Участие в разработке** → [CONTRIBUTING.md](.github/CONTRIBUTING.md)
* **Дорожная карта** → [GitHub Discussions](https://github.com/orgs/docmd-io/discussions/2)

## Поддержать docmd

Если docmd полезен для вас:

* Поставьте репозиторию звезду ⭐
* Поделитесь с теми, кто создает документацию
* Открывайте issues, присылайте исправления или создавайте плагины
* [Станьте спонсором разработки на GitHub](https://github.com/sponsors/mgks)

## Лицензия

Лицензия MIT. Смотрите [LICENSE](LICENSE) для подробностей.
