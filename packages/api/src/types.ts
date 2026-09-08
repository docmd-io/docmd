/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * @package     @docmd/api
 * @website     https://docmd.io
 * @repository  https://github.com/docmd-io/docmd
 * @license     MIT
 * @copyright   Copyright (c) 2025-present docmd.io
 *
 * [docmd-source] - Please do not remove this header.
 * --------------------------------------------------------------------
 */

// ---------------------------------------------------------------------------
// Plugin Descriptor & Capabilities (§1, §3 of advanced-plugin-plan)
// ---------------------------------------------------------------------------

/** Known hook categories that a plugin can declare. */
export type Capability =
  | 'markdown'
  | 'head'
  | 'body'
  | 'assets'
  | 'post-build'
  | 'actions'
  | 'events'
  | 'translations'
  | 'init'
  | 'build'
  | 'dev'
  | 'template';

/**
 * Every plugin should export a `plugin` descriptor.
 * Required starting 0.8.0; currently a soft deprecation warning is
 * emitted when missing.
 */
export interface PluginDescriptor {
  /** Unique identifier for this plugin. */
  name: string;
  /** Semver version string. */
  version: string;
  /** Declared hook categories this plugin uses. */
  capabilities: Capability[];
  /**
   * Whether this plugin requires an active docmd live development server.
   * When true, client assets and scripts are automatically omitted during static builds (`docmd build`).
   */
  requiresLiveServer?: boolean;
}

// ---------------------------------------------------------------------------
// Action / Event system (RPC)
// ---------------------------------------------------------------------------

/**
 * Context provided to plugin action and event handlers.
 *
 * Contains file I/O helpers, source editing tools, and project metadata.
 * All file operations are sandboxed to the project root directory.
 */
export interface ActionContext {
  /** Absolute path to the project root directory. */
  projectRoot: string;
  /** Current docmd site configuration. */
  config: any;
  /** Read a file relative to the project root. */
  readFile(relativePath: string): Promise<string>;
  /** Write a file relative to the project root. Sets the modification flag. */
  writeFile(relativePath: string, content: string): Promise<void>;
  /** Read a file as an array of lines. */
  readFileLines(relativePath: string): Promise<string[]>;
  /** Broadcast an event to all connected browser clients. */
  broadcast(event: string, data: any): void;
  /** Source editing tools for block-level markdown manipulation. */
  source: SourceTools;
  /** Execute a generic function inside the multi-threaded worker pool. */
  runWorkerTask<T = any>(modulePath: string, functionName: string, args: any[]): Promise<T>;
}

/**
 * Handler for a named plugin action (WebSocket RPC).
 * Returns a result that is sent back to the browser client.
 */
export type ActionHandler = (payload: any, ctx: ActionContext) => Promise<any>;

/** Handler for a fire-and-forget plugin event. */
export type EventHandler = (data: any, ctx: ActionContext) => void;

/** Result of dispatching an action call. */
export interface DispatchResult {
  result: any;
  reload: boolean;
}

// ---------------------------------------------------------------------------
// Source Editing Tools
// ---------------------------------------------------------------------------

/**
 * Source editing tools that translate rendered-output references
 * (block IDs, text offsets) back to raw markdown source positions.
 */
export interface SourceTools {
  /** Get block content and inline segments at a given source map reference. */
  getBlockAt(file: string, blockRef: [number, number], options?: { textOffset?: number }): Promise<BlockInfo>;
  /** Locate text within a block and return its source position. */
  findText(file: string, blockRef: [number, number], text: string, textOffset?: number): Promise<TextLocation | null>;
  /** Wrap text within a block with syntax markers (e.g., `==`, `**`). */
  wrapText(file: string, blockRef: [number, number], text: string, textOffset: number, before: string, after: string): Promise<void>;
  /** Insert markdown content after a block. */
  insertAfter(file: string, blockRef: [number, number], content: string): Promise<void>;
  /** Replace an entire block's source lines. */
  replaceBlock(file: string, blockRef: [number, number], content: string): Promise<void>;
  /** Remove a block's source lines. */
  removeBlock(file: string, blockRef: [number, number]): Promise<void>;
  /**
   * Enumerate every top-level block in a file (D-H4). Returns
   * `BlockInfo[]` with `line.start` and `line.end` populated — the
   * other methods can then be called with the returned blockRef.
   * Blocks are delimited by blank lines (a paragraph-level split
   * that handles the common case of editing a single paragraph or
   * list at a time).
   */
  getBlocks(file: string): Promise<BlockInfo[]>;
}

/** Information about a block in the markdown source. */
export interface BlockInfo {
  id: string | null;
  line: { start: number; end: number };
  raw: string;
  textContent: string;
  segments: InlineSegment[];
  cursor: InlineSegment | null;
  ancestors: any[];
}

/** A contiguous run of text content with optional surrounding syntax. */
export interface InlineSegment {
  text: string;
  rawOffset: number;
  rawLength: number;
  syntax: [string, string] | null;
}

/** Source position of located text within a block. */
export interface TextLocation {
  line: number;
  startCol: number;
  endCol: number;
  rawText: string;
  wrappingSyntax: { before: string | null; after: string | null };
}

// ---------------------------------------------------------------------------
// Plugin Module Interface
// ---------------------------------------------------------------------------

/**
 * Interface for a docmd plugin module.
 *
 * Plugins can export any combination of build-time hooks and runtime
 * action/event handlers.
 */
export interface PluginModule {
  /** Plugin descriptor (required starting 0.8.0). */
  plugin?: PluginDescriptor;
  /** Extend the markdown-it parser instance. */
  markdownSetup?(md: any, options?: any): void;
  /** Inject meta/link tags into the HTML head. */
  generateMetaTags?(config: any, page: any, relativePathToRoot: string): string | Promise<string>;
  /** Inject scripts into head and/or body. */
  generateScripts?(config: any, options?: any): { headScriptsHtml?: string; bodyScriptsHtml?: string };
  /** Define external assets (JS/CSS) to inject. */
  getAssets?(options?: any): Asset[];
  /** Run logic before HTML generation, after markdown parsing. */
  onBeforeBuild?(ctx: BeforeBuildContext): Promise<void>;
  /** Run logic after all HTML files are generated. */
  onPostBuild?(ctx: PostBuildContext): Promise<void>;
  /** Locale-specific UI string overrides. */
  translations?(localeId: string, options?: any): Record<string, string>;
  /** Named action handlers for WebSocket RPC calls from the browser. */
  actions?: Record<string, ActionHandler>;
  /** Named event handlers for fire-and-forget messages from the browser. */
  events?: Record<string, EventHandler>;
  /** Whether this plugin should run on noStyle pages (default: true). */
  noStyle?: boolean;

  // --- Lifecycle Hooks ---
  /** Read/modify normalized config right after initialization. */
  onConfigResolved?(config: any): void | Promise<void>;
  /** Access the dev server instance. */
  onDevServerReady?(server: any, wss: any): void | Promise<void>;
  /** Modify raw markdown before parsing. Called per page. */
  onBeforeParse?(src: string, frontmatter: any, filePath?: string): string | Promise<string>;
  onAfterParse?(html: string, frontmatter: any, filePath?: string): string | Promise<string>;
  /**
   * Called BEFORE template rendering. Receives the page context including
   * `sourcePath` (absolute path to the source .md file), `frontmatter`,
   * and `html`. Mutations are reflected in the rendered output.
   *
   * This is the right hook for plugins that need to inject data derived
   * from the source file (e.g. reading frontmatter, computing metadata)
   * before the template runs.
   */
  onBeforeRender?(page: PageContext): void | Promise<void>;
  /** Access fully assembled page object before write. */
  onPageReady?(page: any): void | Promise<void>;

  // --- Template System (new in 0.8.7) ---
  /**
   * Template file overrides. Requires the `template` capability on the
   * plugin descriptor. The resolver in @docmd/ui merges these with the
   * default templates shipped with the core, falling back to the default
   * for any slot the plugin does not provide.
   */
  templates?: TemplateHook[];
  /**
   * CSS/JS asset bundles shipped with the template. Requires the `template`
   * capability. Loaded at priority 10 by default so user customCss (15) wins.
   */
  templateAssets?: TemplateAssetHook[];
}

// ---------------------------------------------------------------------------
// Page Context — available in onBeforeRender
// ---------------------------------------------------------------------------

/**
 * Page context object passed to `onBeforeRender`.
 * Always includes `sourcePath` so plugins can read the source file,
 * compute file-based metadata, and inject it before templating.
 */
export interface PageContext {
  /** Absolute path to the source .md file. Always set. */
  sourcePath: string;
  /** Parsed frontmatter object. Plugins may mutate this. */
  frontmatter: Record<string, any>;
  /** Rendered HTML body (between template slots). Plugins may mutate this. */
  html: string;
  /** Locale id active for this page. */
  localeId?: string;
  /** Version id active for this page (if versioning enabled). */
  versionId?: string;
  /** Relative path from the output file to the site root. */
  relativePathToRoot?: string;
  /** Execute a generic function inside the multi-threaded worker pool. */
  runWorkerTask<T = any>(modulePath: string, functionName: string, args: any[]): Promise<T>;
}

// ---------------------------------------------------------------------------
// Build Contexts
// ---------------------------------------------------------------------------

/**
 * D-M2: minimal canonical types for the build contexts. Previously both
 * `config` and `pages` were `any`, which forced plugin authors to either
 * reach for type assertions or write untyped code. Plugin authors who
 * need richer shapes can still cast to a wider type — these are the
 * structural minimums that every plugin can rely on.
 *
 * The full config shape lives in `@docmd/core`'s `normalizeConfig`
 * output; exposing it here would create a circular import. Plugin
 * authors who need the full shape can extend with intersection types.
 */
export interface DocConfigShape {
  title: string;
  url?: string;
  base?: string;
  src?: string;
  out?: string;
  theme?: Record<string, any>;
  layout?: Record<string, any>;
  i18n?: Record<string, any>;
  versions?: Record<string, any>;
  workspace?: Record<string, any>;
  plugins?: Record<string, any>;
  [key: string]: any;
}

export interface PageInfoShape {
  sourcePath: string;
  outputPath: string;
  frontmatter: Record<string, any>;
  htmlContent?: string;
  rawMarkdown?: string;
  headings?: Array<{ id: string; text: string; level: number }>;
  urls?: Record<string, string>;
  urlContext?: Record<string, any>;
  config?: DocConfigShape;
  [key: string]: any;
}

/** Context provided to onBeforeBuild hooks. */
export interface BeforeBuildContext {
  config: DocConfigShape;
  pages: PageInfoShape[];
  tui: any; // @docmd/tui instance for progress bars and spinners
  options: any;
  /** Execute a generic function inside the multi-threaded worker pool. */
  runWorkerTask<T = any>(modulePath: string, functionName: string, args: any[]): Promise<T>;
}

/** Context provided to onPostBuild hooks. */
export interface PostBuildContext {
  config: DocConfigShape;
  pages: PageInfoShape[];
  outputDir: string;
  tui: any; // @docmd/tui instance for progress bars and spinners
  log: (msg: string) => void;
  options: any;
  /** Execute a generic function inside the multi-threaded worker pool. */
  runWorkerTask<T = any>(modulePath: string, functionName: string, args: any[]): Promise<T>;
}

// ---------------------------------------------------------------------------
// Hook Registry Shape
// ---------------------------------------------------------------------------

/** The shape of the hooks object maintained by the plugin loader. */
export interface PluginHooks {
  markdownSetup: ((md: any) => void)[];
  injectHead: ((config: any, pageContext: any, root?: string) => string | Promise<string>)[];
  injectBody: ((config: any, pageContext: any, root?: string) => string | Promise<string>)[];
  onBeforeBuild: ((ctx: BeforeBuildContext) => Promise<void>)[];
  onPostBuild: ((ctx: PostBuildContext) => Promise<void>)[];
  assets: (() => Asset[] | Promise<Asset[]>)[];
  translations: ((localeId: string) => Record<string, string> | Promise<Record<string, string>>)[];
  actions: Record<string, ActionHandler>;
  events: Record<string, EventHandler>;

  // Lifecycle Hooks
  onConfigResolved: ((config: any) => void | Promise<void>)[];
  onDevServerReady: ((server: any, wss: any) => void | Promise<void>)[];
  onBeforeParse: ((src: string, frontmatter: any, filePath?: string) => string | Promise<string>)[];
  onAfterParse: ((html: string, frontmatter: any, filePath?: string) => string | Promise<string>)[];
  /** Called before template rendering. Receives full PageContext. */
  onBeforeRender: ((page: PageContext) => void | Promise<void>)[];
  onPageReady: ((page: any) => void | Promise<void>)[];

  // Template System (new in 0.8.7)
  /** Template file overrides registered by template plugins. */
  templates: TemplateHook[];
  /** Asset bundles registered by template plugins. */
  templateAssets: TemplateAssetHook[];
}

// ---------------------------------------------------------------------------
// Engine Interface (§ Engine Abstraction Layer)
// ---------------------------------------------------------------------------

/**
 * Task definition for engine execution.
 * Engines receive tasks and return results - they don't know or care
 * what the task does, they just execute it.
 */
export interface EngineTask {
  /** Task type identifier (e.g., 'file:discover', 'git:log', 'search:index') */
  type: string;
  /** Task payload - any serializable data */
  payload: any;
  /** Optional timeout in milliseconds */
  timeout?: number;
}

/**
 * Result from an engine task execution.
 */
export interface EngineResult<T = any> {
  /** Whether the task succeeded */
  success: boolean;
  /** Result data if successful */
  data?: T;
  /** Error message if failed */
  error?: string;
  /** Execution time in milliseconds */
  duration?: number;
}

/**
 * Engine interface for pluggable build acceleration.
 *
 * Engines are simple task executors - they receive a task and return a result.
 * The API layer controls what tasks are allowed and how they're structured.
 * This keeps engines language-agnostic and allows any tool (docmd, docmd-search, etc.)
 * to use them without tight coupling.
 *
 * @example
 * ```typescript
 * const engine = await loadEngine('rust');
 * const result = await engine.run({ type: 'file:discover', payload: { dir: './docs' } });
 * if (result.success) {
 *   console.log('Found files:', result.data);
 * }
 * ```
 */
export interface Engine {
  /** Engine descriptor with name and version. */
  readonly name: string;
  readonly version: string;
  
  /**
   * Execute a task and return the result.
   * This is the only method engines need to implement.
   * 
   * @param task - The task to execute
   * @returns The result of the task execution
   */
  run<T = any>(task: EngineTask): Promise<EngineResult<T>>;
  
  /**
   * Check if the engine supports a given task type.
   * Optional - if not implemented, engine assumes it can try any task.
   */
  supports?(taskType: string): boolean;
  
  /**
   * Initialize the engine. Called once before first use.
   */
  init?(options?: EngineInitOptions): Promise<void>;
  
  /**
   * Clean up resources. Called when the engine is no longer needed.
   */
  destroy?(): Promise<void>;
}

/**
 * Options passed to engine initialization.
 */
export interface EngineInitOptions {
  /** Project root directory. */
  projectRoot?: string;
  /** Enable debug logging. */
  debug?: boolean;
}

/**
 * Engine loader function type.
 */
export type EngineLoader = () => Promise<Engine | null>;

/**
 * Registry of available engine loaders.
 */
export const engineRegistry: Map<string, EngineLoader> = new Map();

/**
 * Register an engine loader.
 */
export function registerEngine(name: string, loader: EngineLoader): void {
  engineRegistry.set(name, loader);
}

// ---------------------------------------------------------------------------
// Task Types (defined by API, not engines)
// ---------------------------------------------------------------------------

/**
 * Built-in task types that the API layer supports.
 * Engines don't define these - the API does.
 */
export type BuiltinTaskType =
  // File operations
  | 'file:discover'      // Discover files in directory tree
  | 'file:read'          // Read single file
  | 'file:readBatch'     // Read multiple files
  | 'file:write'         // Write file
  | 'file:exists'        // Check if file exists
  // Git operations
  | 'git:log'            // Get git log for file(s)
  | 'git:status'         // Get git status
  // Search operations
  | 'search:index'       // Build search index
  | 'search:query'       // Query search index
  // Generic
  | 'exec:script';       // Execute arbitrary script

/**
 * Payload for file:discover task.
 */
export interface FileDiscoverPayload {
  dir: string;
  extensions?: string[];
  exclude?: string[];
}

/**
 * Payload for file:readBatch task.
 */
export interface FileReadBatchPayload {
  paths: string[];
}

/**
 * Payload for git:log task.
 */
export interface GitLogPayload {
  filePaths: string[];
  maxCommits?: number;
}

/**
 * Payload for search:index task.
 */
export interface SearchIndexPayload {
  documents: Array<{
    id: string;
    title: string;
    content: string;
    path: string;
    locale?: string;
    version?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Asset Declaration (typed, used by getAssets + template assets)
// ---------------------------------------------------------------------------

/** Asset kind. `static` copies the file verbatim; `css`/`js` emit <link>/<script>. */
export type AssetKind = 'css' | 'js' | 'static';

/** Where an asset is injected in the page. */
export type AssetPosition = 'head' | 'body' | 'footer';

/**
 * Asset descriptor returned by `getAssets()` or declared in a template.
 *
 * `priority` controls load order. Lower loads first, higher loads last.
 *   - `0`   base (e.g. docmd-main.css)
 *   - `5`   theme colour overlay (e.g. theme-sky.css)
 *   - `10`  template structure
 *   - `15`  user customCss / customJs (always wins)
 *   - `20`  other plugins
 *
 * Templates MUST NOT use `!important` in CSS so that customCss overrides
 * remain authoritative.
 */
export interface Asset {
  /** Asset kind. */
  type: AssetKind;
  /** Absolute or template-relative path to the source file. */
  path?: string;
  /** Public URL/path where the asset will be served from. */
  url?: string;
  /** Load order. Lower = earlier. Defaults to 0. */
  priority?: number;
  /** Where in the document to inject. Defaults to `head` for css, `body` for js. */
  position?: AssetPosition;
  /** Optional content-hash suffix (e.g. for cache busting). */
  hash?: string;
  /** Optional inline content (mutually exclusive with `path`). */
  inline?: string;

  /**
   * Optional condition for conditional loading. When set, the asset's `<link>`
   * or `<script>` tag is only emitted on pages where the condition matches.
   *
   * Omit this field (or leave `condition` undefined) to keep the legacy
   * behaviour: include the asset on every page.
   *
   * Evaluated per page at build time, so the cost is paid once during the
   * build, not at runtime. Conditional assets still have their files copied
   * to the output directory as usual — only the HTML tag is skipped when the
   * condition fails.
   *
   * @example  Only load mermaid on pages that actually have a diagram block
   * ```ts
   * {
   *   src: 'init-mermaid.js',
   *   dest: 'assets/js/init-mermaid.js',
   *   type: 'js',
   *   position: 'body',
   *   attributes: { type: 'module' },
   *   condition: { pageHtmlMatches: 'class="mermaid"' }
   * }
   * ```
   */
  condition?: AssetCondition;

  // --- Legacy aliases (deprecated; kept for backwards compat with 0.8.x) ---
  /** @deprecated Use `path`. */
  src?: string;
  /** @deprecated Use `url`. */
  dest?: string;
  /** @deprecated Use `position`. */
  location?: 'head' | 'body' | 'none';
  /** @deprecated Use `position`. Legacy maps to `head`/`body`/`none`. */
  attributes?: Record<string, string | boolean>;
}

/**
 * Predicate evaluated against the rendered page to decide whether a
 * conditional asset should be injected. All keys present in the condition
 * must match (logical AND). Within a key, multiple values are OR-ed.
 */
export interface AssetCondition {
  /**
   * The asset is injected only if the page's HTML (post-markdown, pre-template)
   * contains at least one of the given substrings. Use this to gate JS bundles
   * that init a specific markup — e.g. `class="mermaid"` for mermaid blocks,
   * `class="katex"` for KaTeX math, etc.
   *
   * Substring (not selector) so the check stays O(n) and dependency-free.
   * For more advanced matching, combine multiple substrings (OR-ed).
   */
  pageHtmlMatches?: string | string[];
  /**
   * The asset is injected only if the page's parsed frontmatter has this key
   * defined (any value, including `false`). Useful when a page opts in via
   * frontmatter (e.g. `math: true`).
   */
  frontmatterHas?: string;
}

// ---------------------------------------------------------------------------
// Template System (new in 0.8.7)
// ---------------------------------------------------------------------------

/**
 * Logical template slots a template can override.
 *
 * These match the file names that ship in `@docmd/ui/templates/`. A template
 * that provides, say, only `menubar.ejs` will inherit the rest of the layout
 * from the default templates shipped with `@docmd/ui`.
 *
 * Conventions:
 *   - Files live under `templates/` in the template package.
 *   - Partials live under `templates/partials/`.
 *   - File names match the slot name exactly (e.g. `layout.ejs` for `layout`).
 *
 * Templates MAY also define custom partials and include them from inside their
 * own EJS files; only the slots listed here participate in the default
 * resolution chain.
 *
 * Slots currently with default files in `@docmd/ui`:
 *   layout, 404, toc, navigation, footer, menubar, options-menu,
 *   project-switcher, version-dropdown, language-switcher, banner,
 *   cookie-consent.
 *
 * `no-style` pages are not a template slot — they always use the default
 * `templates/no-style.ejs` and are unaffected by the active template.
 */
export type TemplateSlot =
  | 'layout'
  | '404'
  | 'toc'
  | 'navigation'
  | 'footer'
  | 'menubar'
  | 'options-menu'
  | 'project-switcher'
  | 'version-dropdown'
  | 'language-switcher'
  | 'banner'
  | 'cookie-consent';

/**
 * A single template file override registered by a template plugin.
 *
 * Templates register one entry per file they ship. The resolver merges
 * the entries with the default templates from `@docmd/ui`, falling back
 * to the default for any slot the template does not provide.
 */
export interface TemplateHook {
  /** Logical slot this file overrides. */
  type: TemplateSlot;
  /** Absolute path to the `.ejs` file inside the template package. */
  templatePath: string;
  /**
   * Priority within the same slot. Higher wins. Defaults to 0.
   * Useful if multiple plugins contribute templates for the same slot.
   */
  priority?: number;
  /**
   * Glob patterns (e.g. `"blog/*"`) of page paths where this template
   * applies. Omit or pass `[]` to apply to all pages.
   */
  pages?: string[];
  /**
   * Glob patterns of page paths this template must NOT apply to.
   * Evaluated before `pages`.
   */
  exclude?: string[];
}

/**
 * Asset descriptor for a template's own CSS/JS bundle.
 *
 * Templates ship a single CSS file (and optionally a single JS file). These
 * are loaded after the base `docmd-main.css` and before any user `customCss`
 * so the user can always override a template's styles.
 */
export interface TemplateAssetHook {
  type: 'css' | 'js';
  /** Absolute path to the file inside the template package. */
  path: string;
  /** Load priority. Defaults to 10 for templates. */
  priority?: number;
  /** Head or body injection. Defaults are `head` for css, `body` for js. */
  position?: AssetPosition;
}

/**
 * Context passed to the template resolver. The resolver decides which
 * template file to use for a given slot on a given page.
 */
export interface TemplateResolutionContext {
  /** Slot being resolved. */
  type: TemplateSlot;
  /** Absolute path of the page being rendered (post-build path, e.g. `/guide/intro.html`). */
  pagePath: string;
  /** Page frontmatter (may contain `template` override). */
  frontmatter: Record<string, any>;
  /** Resolved site config. */
  config: any;
  /** Locale id for the page, if any. */
  localeId?: string;
  /** Version id for the page, if any. */
  versionId?: string;
}

/**
 * Result of resolving a template slot.
 *
 * `source === 'default'` means no template plugin claimed the slot and the
 * core `@docmd/ui` default is being used. `source === 'frontmatter'` /
 * `'config'` indicates the override path. `source === 'plugin'` indicates
 * a registered template plugin satisfied the request.
 */
export interface ResolvedTemplate {
  /** Absolute filesystem path to the EJS file to render. */
  templatePath: string;
  /** How the resolution arrived at this template. */
  source: 'default' | 'frontmatter' | 'config' | 'plugin';
  /** Plugin name, when `source === 'plugin'`. */
  pluginName?: string;
  /** Slot that was resolved. */
  type: TemplateSlot;
}