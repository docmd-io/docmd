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

import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Resolve the absolute path of a file under `packages/ui/assets/`
 * (e.g. `resolveUiAsset('js/docmd-api.js')`).
 */
export function resolveUiAsset(rel: string): string {
  return path.resolve(fileURLToPath(import.meta.url), '../../../../ui/assets', rel);
}
