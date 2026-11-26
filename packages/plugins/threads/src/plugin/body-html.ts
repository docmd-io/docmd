import { createMarkdownProcessor } from '@docmd/parser';
import type { Thread } from '../types.js';

interface Renderer {
  options: { html: boolean };
  render(source: string, env: Record<string, unknown>): string;
}

/** One Markdown instance per process: made from the config of the first call, like the build's own. */
let shared: Renderer | undefined;

/**
 * Render a comment body to HTML the way the build renders published ones: the site's
 * Markdown options and docmd's code highlighter, raw HTML escaped. Rules that other docmd
 * plugins add are not run, so a draft using another plugin's syntax looks plainer until it
 * is published and the page HTML takes over.
 */
export function renderBodyHtml(config: unknown, body: string): string {
  shared ??= createMarkdownProcessor((config ?? {}) as object, undefined) as Renderer;
  const previous = shared.options.html;
  shared.options.html = false;
  try {
    return shared.render(body, { isInsideContainer: true });
  } finally {
    shared.options.html = previous;
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
