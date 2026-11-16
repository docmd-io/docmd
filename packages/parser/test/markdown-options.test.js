/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * markdown-options — configurable linkify, typographer, breaks, and
 * HTTPS autolinking normalisation.
 *
 * Regression coverage for:
 *   - Configurable markdown.linkify & markdown.typographer in config
 *   - Autolinked bare domains defaulting to https://
 *   - Configurable markdown.breaks
 *
 * Run: `pnpm --filter @docmd/parser test`
 * --------------------------------------------------------------------
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarkdownProcessor, processContent, validateConfig } from '../dist/index.js';

test('autolinked bare domains default to https://', () => {
  const md = createMarkdownProcessor();
  const rendered = md.render('Visit docmd.io or sub.example.org/path for details.');

  assert.match(rendered, /href="https:\/\/docmd\.io"/);
  assert.match(rendered, /href="https:\/\/sub\.example\.org\/path"/);
  assert.doesNotMatch(rendered, /href="http:\/\/docmd\.io"/);
});

test('autolinked www bare domains default to https://', () => {
  const md = createMarkdownProcessor();
  const rendered = md.render('Visit www.docmd.io.');

  assert.match(rendered, /href="https:\/\/www\.docmd\.io"/);
  assert.doesNotMatch(rendered, /href="http:\/\/www\.docmd\.io"/);
});

test('explicit http:// URLs are preserved as http://', () => {
  const md = createMarkdownProcessor();
  const rendered = md.render('Insecure site: http://insecure.example.com');

  assert.match(rendered, /href="http:\/\/insecure\.example\.com"/);
  assert.doesNotMatch(rendered, /href="https:\/\/insecure\.example\.com"/);
});

test('explicit markdown links with http:// are preserved', () => {
  const md = createMarkdownProcessor();
  const rendered = md.render('[Insecure Link](http://insecure.example.com)');

  assert.match(rendered, /href="http:\/\/insecure\.example\.com"/);
});

test('email addresses are preserved as mailto:', () => {
  const md = createMarkdownProcessor();
  const rendered = md.render('Contact us at hello@docmd.io.');

  assert.match(rendered, /href="mailto:hello@docmd\.io"/);
});

test('markdown.linkify: false disables bare domain and email autolinking', () => {
  const md = createMarkdownProcessor({ markdown: { linkify: false } });
  const rendered = md.render('Visit docmd.io or email hello@docmd.io.');

  assert.doesNotMatch(rendered, /<a /);
  assert.match(rendered, /Visit docmd\.io or email hello@docmd\.io\./);
});

test('markdown.typographer: false disables smart quotes and symbols', () => {
  const mdDisabled = createMarkdownProcessor({ markdown: { typographer: false } });
  const renderedDisabled = mdDisabled.render('(c) 2026 -- "quotes"');

  assert.match(renderedDisabled, /\(c\)/);
  assert.match(renderedDisabled, /--/);

  const mdDefault = createMarkdownProcessor();
  const renderedDefault = mdDefault.render('(c) 2026 -- "quotes"');

  assert.match(renderedDefault, /©/);
});

test('markdown.breaks: false disables soft line breaks', () => {
  const mdNoBreaks = createMarkdownProcessor({ markdown: { breaks: false } });
  const renderedNoBreaks = mdNoBreaks.render('first line\nsecond line');

  assert.doesNotMatch(renderedNoBreaks, /<br>/);

  const mdDefault = createMarkdownProcessor();
  const renderedDefault = mdDefault.render('first line\nsecond line');

  assert.match(renderedDefault, /<br>/);
});

test('default heading IDs use nested (contextual) hierarchy and collapse dashes', () => {
  const md = createMarkdownProcessor();
  const input = '# Security Model\n\n## Docker Socket & Security\n\n### Access Controls';
  const rendered = md.render(input);

  assert.match(rendered, /<h1[^>]*id="security-model"/);
  assert.match(rendered, /<h2[^>]*id="security-model-docker-socket-security"/);
  assert.match(rendered, /<h3[^>]*id="security-model-docker-socket-security-access-controls"/);
});

test('markdown.headingIds: "github" produces flat GitHub-compatible slug ids (#286)', () => {
  const md = createMarkdownProcessor({ markdown: { headingIds: 'github' } });
  const input = '# Security Model\n\n## Docker Socket & Security\n\n### Access Controls\n\n## Install / Setup\n\n## Docker Socket & Security';
  const rendered = md.render(input);

  // Flat (not prefixed with parent), punctuation dropped, spaces replaced with dash (preserving --)
  assert.match(rendered, /<h1[^>]*id="security-model"/);
  assert.match(rendered, /<h2[^>]*id="docker-socket--security"/);
  assert.match(rendered, /<h3[^>]*id="access-controls"/);
  assert.match(rendered, /<h2[^>]*id="install--setup"/);

  // Hard collisions on duplicate headings append -1, -2
  assert.match(rendered, /<h2[^>]*id="docker-socket--security-1"/);
});

test('frontmatter headingIds overrides config style per page', () => {
  const mdDefault = createMarkdownProcessor();
  const pageWithGithub = '---\ntitle: Page\nheadingIds: github\n---\n# Security Model\n\n## Docker Socket & Security';
  const res1 = processContent(pageWithGithub, mdDefault, {});
  assert.match(res1.htmlContent, /<h2[^>]*id="docker-socket--security"/);
  assert.equal(res1.headings[1].id, 'docker-socket--security');

  const mdGithub = createMarkdownProcessor({ markdown: { headingIds: 'github' } });
  const pageWithNested = '---\ntitle: Page\nheadingIds: nested\n---\n# Security Model\n\n## Docker Socket & Security';
  const res2 = processContent(pageWithNested, mdGithub, { markdown: { headingIds: 'github' } });
  assert.match(res2.htmlContent, /<h2[^>]*id="security-model-docker-socket-security"/);
  assert.equal(res2.headings[1].id, 'security-model-docker-socket-security');
});

test('frontmatter heading-ids and heading_ids aliases work', () => {
  const md = createMarkdownProcessor();
  const pageKebab = '---\ntitle: Page\nheading-ids: github\n---\n## Docker Socket & Security';
  const resKebab = processContent(pageKebab, md, {});
  assert.match(resKebab.htmlContent, /<h2[^>]*id="docker-socket--security"/);

  const pageSnake = '---\ntitle: Page\nheading_ids: github\n---\n## Docker Socket & Security';
  const resSnake = processContent(pageSnake, md, {});
  assert.match(resSnake.htmlContent, /<h2[^>]*id="docker-socket--security"/);
});

test('validateConfig checks markdown.headingIds valid values', () => {
  const validGithub = validateConfig({ title: 'Test', markdown: { headingIds: 'github' } });
  assert.equal(validGithub.warnings.some(w => w.includes('markdown.headingIds')), false);

  const validNested = validateConfig({ title: 'Test', markdown: { headingIds: 'nested' } });
  assert.equal(validNested.warnings.some(w => w.includes('markdown.headingIds')), false);

  const invalid = validateConfig({ title: 'Test', markdown: { headingIds: 'flat' } });
  assert.equal(invalid.warnings.some(w => w.includes('"markdown.headingIds" must be either "nested" or "github"')), true);
});
