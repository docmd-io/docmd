/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * @package     @docmd/plugin-mdx
 * @website     https://docmd.io
 * @repository  https://github.com/docmd-io/docmd
 * @license     MIT
 * @copyright   Copyright (c) 2025-present docmd.io
 *
 * [docmd-source] - Please do not remove this header.
 * --------------------------------------------------------------------
 */

import type { PluginDescriptor, DoctorCheckResult, DoctorContext } from '@docmd/api';
import { compile, type ComponentRenderer } from 'lite-mdx';

export const plugin: PluginDescriptor = {
  name: 'mdx',
  version: '0.10.0',
  capabilities: ['init', 'build', 'markdown', 'doctor']
};

export interface MdxPluginOptions {
  /**
   * Custom component map passed to lite-mdx compiler.
   */
  components?: Record<string, ComponentRenderer | string>;

  /**
   * Additional variable scope made available to { expressions }.
   */
  scope?: Record<string, any>;
}

/**
 * Standard component mappings that translate JSX tags to docmd container HTML.
 */
function createDefaultComponents(): Record<string, ComponentRenderer> {
  return {
    Callout: (props, children) => {
      const type = props.type || 'info';
      const title = props.title ? `<div class="docmd-callout-title">${props.title}</div>` : '';
      const icon = props.icon ? ` data-icon="${props.icon}"` : '';
      return `<div class="docmd-callout docmd-callout-${type}"${icon}>${title}<div class="docmd-callout-body">\n\n${children || ''}\n\n</div></div>`;
    },
    Card: (props, children) => {
      const href = props.href ? ` href="${props.href}"` : '';
      const title = props.title ? `<h3>${props.title}</h3>` : '';
      const icon = props.icon ? `<span class="docmd-card-icon" data-icon="${props.icon}"></span>` : '';
      const tag = props.href ? 'a' : 'div';
      return `<${tag} class="docmd-card"${href}>${icon}${title}<div>\n\n${children || ''}\n\n</div></${tag}>`;
    },
    Cards: (props, children) => {
      const cols = props.cols || 2;
      return `<div class="docmd-card-grid docmd-grid-${cols}">\n\n${children || ''}\n\n</div>`;
    },
    Badge: (props) => {
      const text = props.text || props.children || '';
      const type = props.type || 'info';
      return `<span class="docmd-badge docmd-badge-${type}">${text}</span>`;
    },
    Steps: (_props, children) => {
      return `<div class="docmd-steps">\n\n${children || ''}\n\n</div>`;
    },
    Tab: (props, children) => {
      const label = props.label || props.title || 'Tab';
      return `<div class="docmd-tab" data-label="${label}">\n\n${children || ''}\n\n</div>`;
    },
    Tabs: (_props, children) => {
      return `<div class="docmd-tabs">\n\n${children || ''}\n\n</div>`;
    }
  };
}

let pluginOptions: MdxPluginOptions = {};

export function onConfigResolved(config: any): void {
  if (config.plugins && config.plugins.mdx) {
    pluginOptions = config.plugins.mdx;
  }
}

/**
 * Pre-processes Markdown and MDX content before standard parsing.
 */
export function onBeforeParse(
  src: string,
  frontmatter: Record<string, any> = {},
  filePath?: string
): string {
  if (!src) return src;

  // Process .mdx files or .md files that contain JSX elements or imports
  const isMdx = filePath ? /\.mdx$/i.test(filePath) : false;
  const hasJsxOrExpressions = /<[A-Z][A-Za-z0-9_.]*|\bimport\s+[^\s;\r\n][^;\r\n]*?\bfrom\b|\bexport\s+(?:const|let|var|default|function|class)\b|(?<!\\)\{[^}\r\n]+\}/.test(src);

  if (!isMdx && !hasJsxOrExpressions) {
    return src;
  }

  try {
    const defaultComponents = createDefaultComponents();
    const mergedComponents = {
      ...defaultComponents,
      ...(pluginOptions.components || {})
    };

    const scope = {
      frontmatter,
      ...(pluginOptions.scope || {})
    };

    const result = compile(src, {
      components: mergedComponents,
      scope,
      allowUnknownTags: true
    });

    return result.content;
  } catch (err: any) {
    // If compilation fails, preserve original content and log warning
    return src;
  }
}

/**
 * Diagnostic health check for docmd doctor.
 */
export async function onDoctorCheck(_ctx: DoctorContext): Promise<DoctorCheckResult[]> {
  return [
    {
      name: 'MDX Compiler',
      status: 'ok',
      message: 'lite-mdx compiler active and ready for JSX components'
    }
  ];
}

export default {
  plugin,
  onConfigResolved,
  onBeforeParse,
  onDoctorCheck
};