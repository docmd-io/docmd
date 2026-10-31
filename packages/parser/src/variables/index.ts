/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * @package     @docmd/parser
 * @website     https://docmd.io
 * @repository  https://github.com/docmd-io/docmd
 * @license     MIT
 * @copyright   Copyright (c) 2025-present docmd.io
 *
 * [docmd-source] - Please do not remove this header.
 * --------------------------------------------------------------------
 */

export { VariableRegistry, getNestedValue } from './registry.js';
export type { VariableContext, VariableRegistryOptions } from './registry.js';
export {
  interpolateVariables,
  interpolateConfigVariables,
  parseVariableExpression
} from './interpolator.js';
export type { InterpolationOptions } from './interpolator.js';
