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

import { createMarkdownProcessor, processContent, processContentAsync, flushNormaliserWarnings, setNormaliserVerbose } from './markdown-processor.js';
import { renderTemplateAsync } from './html-renderer.js';
import { renderIcon } from './utils/icon-renderer.js';
import { validateConfig } from './utils/validator.js';

export {
  // Logic
  createMarkdownProcessor,
  processContent,
  processContentAsync,
  renderTemplateAsync,
  validateConfig,

  // Utils
  renderIcon,
  flushNormaliserWarnings,
  setNormaliserVerbose
};

export { parseContainerHeader, stripContainerComment, parseTitleAndIcon } from './utils/container-helper.js';
export { createDepthTrackingContainer } from './features/index.js';
export {
  normaliseContainers,
  classifyLine,
  indentOf,
  SELF_CLOSING_CONTAINER_NAMES
} from './utils/container-normaliser.js';
export type {
  NormaliserWarning,
  NormaliserWarningSeverity,
  NormaliserResult,
  NormaliserOptions
} from './utils/container-normaliser.js';
export { findPageNeighbors, findBreadcrumbs } from './utils/navigation-helper.js';
export { normalizeInternalHref, normalizeNavPaths, normalizeMenubarPaths, resolveHref } from './utils/normalize-href.js';

// Centralised URL Utilities - the single source of truth for all URL transformations.
// Plugins, templates, and engine components MUST use these instead of rolling their own.
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
  normaliseBaseTag,
} from './utils/url-utils.js';
export type { UrlContext, PageUrls } from './utils/url-utils.js';

// Variables Engine
export {
  VariableRegistry,
  interpolateVariables,
  interpolateConfigVariables,
  parseVariableExpression,
  getNestedValue
} from './variables/index.js';
export type {
  VariableContext,
  VariableRegistryOptions,
  InterpolationOptions
} from './variables/index.js';