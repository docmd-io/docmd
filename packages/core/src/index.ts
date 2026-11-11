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

export function defineConfig(config: any): any {
  return config;
}

export { buildSite as build } from './commands/build.js';
export { startDevServer as dev } from './commands/dev.js';
export { startServe as serve } from './commands/serve.js';
export { buildLive } from './commands/live.js';

// D-H2: re-export the workspace helpers under their documented names.
// The skill/docs reference `buildWorkspace`, `detectWorkspace`, and
// `isWorkspace` directly; previously only `build` (= buildSite) was
// exposed from the package root and consumers got `SyntaxError:
// does not provide an export named 'buildWorkspace'` at import time.
export { buildWorkspace, detectWorkspace, isWorkspace } from './engine/workspace.js';

// Re-export from @docmd/api for backward compatibility
// These modules have moved to @docmd/api as of 0.7.1.
// Direct imports from @docmd/core continue to work but consumers
// are encouraged to migrate to @docmd/api.
export { createActionDispatcher, safePath, createSourceTools } from '@docmd/api';

// Plugin API types (re-exported from @docmd/api)
export type {
  ActionCaller,
  ServerHandle,
  ActionContext,
  ActionHandler,
  EventHandler,
  DispatchResult,
  PluginModule,
  PluginDescriptor,
  PluginHooks,
  Capability,
  SourceTools,
  BlockInfo,
  InlineSegment,
  TextLocation,
} from '@docmd/api';