import { test } from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import tags from '../dist/features/tags.js';
import buttons from '../dist/features/buttons.js';
import tooltip from '../dist/features/tooltip.js';
import changelog from '../dist/features/changelog.js';
import commonContainers from '../dist/features/common-containers.js';

function createParser() {
  const md = new MarkdownIt({ html: true });
  commonContainers.setup(md);
  tags.setup(md);
  buttons.setup(md);
  tooltip.setup(md);
  changelog.setup(md);
  return md;
}

test('tags: supports explicit named title property', () => {
  const md = createParser();
  const input = '::: tag title:"Download Template" link:external:/assets/docs/template.csv icon:download';
  const html = md.render(input);
  assert.ok(html.includes('<span class="docmd-tag">'), 'renders tag span');
  assert.ok(html.includes('Download Template'), 'renders title text');
  assert.ok(!html.includes('title:'), 'does not contain literal title: prefix');
  assert.ok(html.includes('href="/assets/docs/template.csv"'), 'renders link href');
  assert.ok(html.includes('target="_blank"'), 'renders external target');
});

test('tags: supports text and label properties as aliases for title', () => {
  const md = createParser();
  const input1 = '::: tag text:"Beta Version" color:warning';
  const html1 = md.render(input1);
  assert.ok(html1.includes('Beta Version'), 'renders text property');

  const input2 = '::: tag label:"Stable Build" color:success';
  const html2 = md.render(input2);
  assert.ok(html2.includes('Stable Build'), 'renders label property');
});

test('tags: preserves backward compatibility for positional quotes and bare words', () => {
  const md = createParser();
  const input1 = '::: tag "Deprecated" color:#ef4444';
  const html1 = md.render(input1);
  assert.ok(html1.includes('Deprecated'), 'renders quoted positional tag');

  const input2 = '::: tag v0.9.0 color:blue';
  const html2 = md.render(input2);
  assert.ok(html2.includes('v0.9.0'), 'renders bare positional tag');
});

test('buttons: supports explicit named title property', () => {
  const md = createParser();
  const input = '::: button title:"Quick Start Guide" url:"./getting-started/quick-start.md" icon:rocket';
  const html = md.render(input);
  assert.ok(html.includes('<a href="getting-started/quick-start.md" class="docmd-button">') || html.includes('class="docmd-button"'), 'renders button element');
  assert.ok(html.includes('Quick Start Guide'), 'renders button title');
  assert.ok(!html.includes('title:'), 'does not contain literal title: prefix');
});

test('buttons: supports external links and color overrides with named title', () => {
  const md = createParser();
  const input = '::: button title:"GitHub Repository" url:"external:https://github.com/docmd-io/docmd" icon:github color:#fe551b';
  const html = md.render(input);
  assert.ok(html.includes('href="https://github.com/docmd-io/docmd"'), 'renders external link');
  assert.ok(html.includes('target="_blank"'), 'opens in new tab');
  assert.ok(html.includes('GitHub Repository'), 'renders button text');
  assert.ok(html.includes('background-color: #fe551b'), 'applies custom colour');
});

test('buttons: preserves backward compatibility for positional quotes and underscore bare words', () => {
  const md = createParser();
  const input1 = '::: button "Installation Guide" ../../getting-started/installation.md';
  const html1 = md.render(input1);
  assert.ok(html1.includes('Installation Guide'), 'renders quoted positional title');

  const input2 = '::: button Quick_Start ../../getting-started/quick-start.md';
  const html2 = md.render(input2);
  assert.ok(html2.includes('Quick Start'), 'replaces underscores in positional bare words');
});

test('tooltip: supports named title and label in addition to text', () => {
  const md = createParser();
  const input = '::: tip title:"Zero setup required" term:"Zero-Config" ::: /tip';
  const html = md.render(input);
  assert.ok(html.includes('data-tooltip="Zero setup required"'), 'uses title as tooltip text');
  assert.ok(html.includes('Zero-Config'), 'uses term as displayed term');
});

test('changelog: supports title property in log entries', () => {
  const md = createParser();
  const input = `::: changelog
::: log title:"v1.0.0 (2025-01-01)"
Initial release.
::: /log
::: /changelog`;
  const html = md.render(input);
  assert.ok(html.includes('v1.0.0 (2025-01-01)'), 'renders release title');
  assert.ok(!html.includes('title:'), 'does not contain literal title: prefix');
});

test('cards and callouts: support title, label, and text properties', () => {
  const md = createParser();
  const cardInput = `::: card title:"Architecture Overview" icon:layers
Core engine design.
::: /card`;
  const cardHtml = md.render(cardInput);
  assert.ok(cardHtml.includes('Architecture Overview'), 'renders card title');

  const calloutInput = `::: callout info title:"Important Notice"
Please read carefully.
::: /callout`;
  const calloutHtml = md.render(calloutInput);
  assert.ok(calloutHtml.includes('Important Notice'), 'renders callout title');
});
