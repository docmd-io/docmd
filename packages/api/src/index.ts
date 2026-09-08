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

// Plugin loader & hook registry
export { loadPlugins, hooks, resolvePluginName, resolveTemplateName, getPluginErrors, getPluginLoadErrors, CORE_PLUGINS, isCorePlugin } from './hooks.js';

// Runtime dependency bootstrap (auto-install pipeline shared by hooks + engines)
export {
  loadRuntimeRegistry,
  detectPackageManager,
  getDocmdVersion,
  isValidRuntimeDepName,
  installRuntimeDep,
  resetInstallState,
  tryLoadAfterInstall,
  shortKey as shortRuntimeDepKey,
  getBuildStatusReporter,
  installPackages,
  manualResolvePackageEntry,
} from './runtime-deps.js';

// RPC action/event dispatcher
export { createActionDispatcher, markFileWrittenByRpc, wasWrittenByRpc } from './rpc.js';

// Path safety helper — canonical implementation lives in @docmd/utils.
// Re-exported here for backward compatibility with existing plugin imports.
export { safePath, asUserPath } from '@docmd/utils';
export type { UserPath } from '@docmd/utils';

// Source editing tools
export { createSourceTools } from './source.js';

// TUI tools
export { TUI } from '@docmd/tui';

// ─── Centralised URL Utilities ─────────────────────────────────────────────
// Re-exported from @docmd/parser for plugin consumption.
// Plugins MUST use these instead of rolling their own URL logic.
export {
  sanitizeUrl,
  outputPathToSlug,
  outputPathToPathname,
  outputPathToCanonical,
  buildContextualUrl,
  buildRootRelativeUrl,
  buildAbsoluteContextualUrl,
  stripDefaultLocalePrefixFromHtml,
  rewriteHtmlLinks,
  createUrlContext,
  computePageUrls,
  buildAbsoluteUrl,
  resolveHref,
  normalizeInternalHref,
} from '@docmd/parser';

export type { UrlContext, PageUrls } from '@docmd/parser';

// ─── Engine System ─────────────────────────────────────────────────────────
// Re-exported from engine module.
export {
  engineRegistry,
  registerEngine,
  loadEngine,
  isEngineAvailable,
  getAvailableEngines,
  runTask,
  discoverFiles,
  readFilesBatch,
  getGitLog,
  buildSearchIndex,
} from './engine.js';

// Types
export type {
  // Plugin system
  PluginDescriptor,
  PluginModule,
  PluginHooks,
  Capability,
  PageContext,
  PostBuildContext,
  // Action/Event system
  ActionContext,
  ActionHandler,
  EventHandler,
  DispatchResult,
  // Source tools
  SourceTools,
  BlockInfo,
  InlineSegment,
  TextLocation,
  // Engine system
  Engine,
  EngineTask,
  EngineResult,
  EngineLoader,
  EngineInitOptions,
  BuiltinTaskType,
  FileDiscoverPayload,
  FileReadBatchPayload,
  GitLogPayload,
  SearchIndexPayload,
  // Assets
  Asset,
  AssetCondition,
  AssetKind,
  AssetPosition,
  // Template system
  TemplateSlot,
  TemplateHook,
  TemplateAssetHook,
  TemplateResolutionContext,
  ResolvedTemplate,
} from './types.js';