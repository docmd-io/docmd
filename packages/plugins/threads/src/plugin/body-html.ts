import { createMarkdownProcessor } from '@docmd/parser';
import type { Thread } from '../types.js';

interface Renderer {
  options: { html: boolean };
  render(source: string, env: Record<string, unknown>): string;
}

/** One Markdown instance per config object: each site (docs root) keeps the renderer made from its own options. */
const renderers = new WeakMap<object, Renderer>();
/** The renderer for a call with no config object (a bare call, as the tests make). */
let bare: Renderer | undefined;

function rendererFor(config: unknown): Renderer {
  if (typeof config !== 'object' || config === null) return (bare ??= createMarkdownProcessor({}, undefined) as Renderer);
  let renderer = renderers.get(config);
  if (!renderer) {
    renderer = createMarkdownProcessor(config, undefined) as Renderer;
    renderers.set(config, renderer);
  }
  return renderer;
}

/**
 * Render a comment body to HTML the way the build renders published ones: the site's
 * Markdown options and docmd's code highlighter, raw HTML escaped. Rules that other docmd
 * plugins add are not run, so a draft using another plugin's syntax looks plainer until it
 * is published and the page HTML takes over.
 */
export function renderBodyHtml(config: unknown, body: string): string {
  const renderer = rendererFor(config);
  const previous = renderer.options.html;
  renderer.options.html = false;
  try {
    return renderer.render(body, { isInsideContainer: true });
  } finally {
    renderer.options.html = previous;
  }
}

/**
 * Add `bodyHtml` to every comment whose body comes from the caller's journal: a draft comment, or
 * a published one with a pending edit. Published, unchanged comments are left alone: their HTML
 * is already in the page.
 */
export function withBodyHtml(config: unknown, threads: Thread[]): Thread[] {
  for (const t of threads) {
    for (const c of t.comments) {
      if (c.draft || c.pendingEdit) c.bodyHtml = renderBodyHtml(config, c.body);
    }
  }
  return threads;
}
