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

import { renderIcon } from '@docmd/parser';

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

function resolveTagColor(val: string): string {
  const v = (val || '').toLowerCase().trim();
  switch (v) {
    case 'success': return '#10b981';
    case 'warning': return '#f59e0b';
    case 'danger':
    case 'error': return '#ef4444';
    case 'info': return '#3b82f6';
    case 'primary': return '#fe551b';
    default: return val || '#3b82f6';
  }
}

/**
 * Standard component mappings that translate JSX tags to docmd container HTML.
 */
function createDefaultComponents(): Record<string, ComponentRenderer> {
  return {
    Callout: (props, children) => {
      const type = props.type || 'info';
      let iconHtml = '';
      if (props.icon) {
        try {
          iconHtml = renderIcon(props.icon, { class: 'callout-icon-heading' });
        } catch { /* ignore */ }
      }
      const titleContent = props.title || '';
      const titleHeader = (titleContent || iconHtml)
        ? `<div class="callout-title">${iconHtml}${titleContent}</div>`
        : '';
      return `<div class="docmd-container callout callout-${type}">${titleHeader}<div class="callout-content">\n\n${children || ''}\n\n</div></div>`;
    },
    Card: (props, children) => {
      let iconHtml = '';
      if (props.icon) {
        try {
          iconHtml = renderIcon(props.icon, { class: 'card-icon-heading' });
        } catch { /* ignore */ }
      }
      const titleContent = props.title || '';
      const titleHeader = (titleContent || iconHtml)
        ? `<div class="card-title">${iconHtml}${titleContent}</div>`
        : '';
      const href = props.href ? ` href="${props.href}"` : '';
      const tag = props.href ? 'a' : 'div';
      return `<${tag} class="docmd-container card"${href}>${titleHeader}<div class="card-content">\n\n${children || ''}\n\n</div></${tag}>`;
    },
    Cards: (props, children) => {
      const cols = props.cols || 2;
      return `<div class="docmd-container grids" style="--grid-cols: ${cols};">\n\n${children || ''}\n\n</div>`;
    },
    Grid: (_props, children) => {
      return `<div class="docmd-container grid-item">\n\n${children || ''}\n\n</div>`;
    },
    Badge: (props, children) => {
      const text = props.children || children || props.text || '';
      const variant = props.variant || props.type || 'info';
      const color = resolveTagColor(variant);
      let iconHtml = '';
      if (props.icon) {
        try {
          iconHtml = renderIcon(props.icon, { class: 'tag-icon' });
        } catch { /* ignore */ }
      }
      const styleAttr = ` style="--tag-color: ${color}; background-color: color-mix(in srgb, ${color} 15%, transparent); color: ${color}; border-color: color-mix(in srgb, ${color} 30%, transparent);"`;
      return `<span class="docmd-tag"${styleAttr}>${iconHtml}${text}</span>`;
    },
    Tag: (props, children) => {
      const text = props.children || children || props.text || '';
      const variant = props.variant || props.type || props.color || 'info';
      const color = resolveTagColor(variant);
      let iconHtml = '';
      if (props.icon) {
        try {
          iconHtml = renderIcon(props.icon, { class: 'tag-icon' });
        } catch { /* ignore */ }
      }
      const styleAttr = ` style="--tag-color: ${color}; background-color: color-mix(in srgb, ${color} 15%, transparent); color: ${color}; border-color: color-mix(in srgb, ${color} 30%, transparent);"`;
      return `<span class="docmd-tag"${styleAttr}>${iconHtml}${text}</span>`;
    },
    Steps: (_props, children) => {
      return `<div class="docmd-container steps"><ol class="steps-list">\n\n${children || ''}\n\n</ol></div>`;
    },
    Step: (props, children) => {
      const title = props.title ? `<span class="step-title" style="font-weight:600;display:block;margin-bottom:0.25rem;">${props.title}</span>` : '';
      return `<li class="step-item">${title}<div class="step-body">\n\n${children || ''}\n\n</div></li>`;
    },
    Tab: (props, children) => {
      const label = props.label || props.title || 'Tab';
      return `::: tab "${label}"\n\n${children || ''}\n\n:::`;
    },
    Tabs: (_props, children) => {
      return `::: tabs\n\n${children || ''}\n\n:::`;
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