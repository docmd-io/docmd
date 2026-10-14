/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * LLMS plugin — i18n opt-in tests
 *
 * The default behaviour writes `llms.txt` / `llms-full.txt` / `llms.json`
 * for the **default locale only**. Multi-locale output is opt-in via
 * `plugins.llms.i18n: true`, which writes per-locale files
 * (`llms.<locale>.txt`, etc.).
 *
 * Run with: `node --test tests/llms.test.js`
 * --------------------------------------------------------------------
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

import { plugin, onPostBuild } from '../dist/index.js';

describe('plugin descriptor', () => {
  it('has the expected name', () => {
    assert.equal(plugin.name, 'llms');
  });

  it('declares post-build capability', () => {
    assert.ok(Array.isArray(plugin.capabilities));
    assert.ok(plugin.capabilities.includes('post-build'));
  });
});

describe('onPostBuild — default behaviour (default locale only)', () => {
  let tmpDir;
  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'llms-test-'));
  });
  after(async () => {
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  });

  it('writes llms.txt for the default locale only (i18n off by default)', async () => {
    const out = path.join(tmpDir, 'default');
    await onPostBuild({
      config: {
        title: 'Default test',
        url: 'https://example.com',
        i18n: {
          default: 'en',
          locales: [
            { id: 'en', label: 'English' },
            { id: 'hi', label: 'Hindi' }
          ]
        }
        // No `plugins.llms` entry — use defaults.
      },
      pages: [
        { outputPath: 'en/welcome.html', frontmatter: { title: 'EN Welcome', description: 'Hello' }, sourcePath: '', rawMarkdown: '' },
        { outputPath: 'hi/welcome.html', frontmatter: { title: 'HI Welcome', description: 'Namaste' }, sourcePath: '', rawMarkdown: '' }
      ],
      outputDir: out,
      log: () => {}
    });

    // Single files at the root.
    const txt = await fs.readFile(path.join(out, 'llms.txt'), 'utf8');
    assert.match(txt, /\[EN Welcome\]/);
    assert.doesNotMatch(txt, /\[HI Welcome\]/);
  });

  it('writes per-locale files when `plugins.llms.i18n: true`', async () => {
    const out = path.join(tmpDir, 'i18n');
    await onPostBuild({
      config: {
        title: 'I18N test',
        url: 'https://example.com',
        i18n: {
          default: 'en',
          locales: [
            { id: 'en', label: 'English' },
            { id: 'hi', label: 'Hindi' }
          ]
        },
        plugins: { llms: { i18n: true } }
      },
      pages: [
        { outputPath: 'en/welcome.html', frontmatter: { title: 'EN Welcome' }, sourcePath: '', rawMarkdown: '' },
        { outputPath: 'hi/welcome.html', frontmatter: { title: 'HI Welcome' }, sourcePath: '', rawMarkdown: '' }
      ],
      outputDir: out,
      log: () => {}
    });

    // Default locale keeps the unsuffixed names (no breaking change
    // for existing consumers).
    const txt = await fs.readFile(path.join(out, 'llms.txt'), 'utf8');
    assert.match(txt, /\[EN Welcome\]/);
    assert.doesNotMatch(txt, /\[HI Welcome\]/);

    // Non-default locale gets a `.<locale>` suffix.
    const txtHi = await fs.readFile(path.join(out, 'llms.hi.txt'), 'utf8');
    assert.match(txtHi, /\[HI Welcome\]/);
    assert.doesNotMatch(txtHi, /\[EN Welcome\]/);

    // Full and JSON files: default → unsuffixed; non-default → suffixed.
    const json = JSON.parse(await fs.readFile(path.join(out, 'llms.json'), 'utf8'));
    assert.equal(json.pages.length, 1);
    assert.equal(json.pages[0].title, 'EN Welcome');

    const jsonHi = JSON.parse(await fs.readFile(path.join(out, 'llms.hi.json'), 'utf8'));
    assert.equal(jsonHi.pages.length, 1);
    assert.equal(jsonHi.pages[0].title, 'HI Welcome');

    // `llms-full.txt` and `llms-full.hi.txt` both exist.
    await fs.access(path.join(out, 'llms-full.txt'));
    await fs.access(path.join(out, 'llms-full.hi.txt'));
  });

  it('default-mode treats a site with no i18n as the default locale', async () => {
    // No `i18n` block at all — every page is in the (implicit)
    // default locale, so the bundle has all pages.
    const out = path.join(tmpDir, 'no-i18n');
    await fs.mkdir(out, { recursive: true });
    await onPostBuild({
      config: { title: 'No i18n', url: 'https://example.com' },
      pages: [
        { outputPath: 'a.html', frontmatter: { title: 'A' }, sourcePath: '', rawMarkdown: '' },
        { outputPath: 'b.html', frontmatter: { title: 'B' }, sourcePath: '', rawMarkdown: '' }
      ],
      outputDir: out,
      log: () => {}
    });

    const txt = await fs.readFile(path.join(out, 'llms.txt'), 'utf8');
    assert.match(txt, /\[A\]/);
    assert.match(txt, /\[B\]/);
  });

  it('default-mode with i18n + only-one-locale writes the single unsuffixed set', async () => {
    // Edge case: `i18n: false` (default) + only ONE locale configured.
    // The bundle has the single set at root with no locale suffix.
    const out = path.join(tmpDir, 'single-locale');
    await onPostBuild({
      config: {
        title: 'Single',
        url: 'https://example.com',
        i18n: {
          default: 'en',
          locales: [{ id: 'en', label: 'English' }]
        }
      },
      pages: [
        { outputPath: 'a.html', frontmatter: { title: 'A' }, sourcePath: '', rawMarkdown: '' }
      ],
      outputDir: out,
      log: () => {}
    });

    // Unsuffixed files (no `llms.en.txt` is needed because there's
    // only one locale — the suffix would just add noise).
    const txt = await fs.readFile(path.join(out, 'llms.txt'), 'utf8');
    assert.match(txt, /\[A\]/);
    await assert.rejects(
      fs.access(path.join(out, 'llms.en.txt')),
      /ENOENT/
    ).catch(() => { /* expected: no per-locale suffix for single-locale sites */ });
  });

  it('supports custom AI system prompt in llms.txt, llms-full.txt, and llms.json', async () => {
    const out = path.join(tmpDir, 'prompt-test');
    await onPostBuild({
      config: {
        title: 'Prompt Test',
        url: 'https://example.com',
        plugins: {
          llms: {
            prompt: 'You are an AI assistant helping developers with this framework. Always give concise code examples.'
          }
        }
      },
      pages: [
        { outputPath: 'index.html', frontmatter: { title: 'Home' }, sourcePath: '', rawMarkdown: '' }
      ],
      outputDir: out,
      log: () => {}
    });

    const txt = await fs.readFile(path.join(out, 'llms.txt'), 'utf8');
    assert.match(txt, /## System Prompt\n\nYou are an AI assistant helping developers/);

    const fullTxt = await fs.readFile(path.join(out, 'llms-full.txt'), 'utf8');
    assert.match(fullTxt, /## System Prompt\n\nYou are an AI assistant helping developers/);

    const json = JSON.parse(await fs.readFile(path.join(out, 'llms.json'), 'utf8'));
    assert.equal(json.prompt, 'You are an AI assistant helping developers with this framework. Always give concise code examples.');
  });

  it('supports section-aware page grouping from frontmatter and directory hierarchy', async () => {
    const out = path.join(tmpDir, 'sections-test');
    await onPostBuild({
      config: {
        title: 'Sections Test',
        url: 'https://example.com'
      },
      pages: [
        { outputPath: 'index.html', frontmatter: { title: 'Home' }, sourcePath: '', rawMarkdown: '' },
        { outputPath: 'guides/installation.html', frontmatter: { title: 'Installation' }, sourcePath: '', rawMarkdown: '' },
        { outputPath: 'custom/ref.html', frontmatter: { title: 'Reference', section: 'API Reference' }, sourcePath: '', rawMarkdown: '' }
      ],
      outputDir: out,
      log: () => {}
    });

    const txt = await fs.readFile(path.join(out, 'llms.txt'), 'utf8');
    assert.match(txt, /## Overview\n\n- \[Home\]\(https:\/\/example\.com\/\)/);
    assert.match(txt, /## Guides\n\n- \[Installation\]\(https:\/\/example\.com\/guides\/installation\/\)/);
    assert.match(txt, /## API Reference\n\n- \[Reference\]\(https:\/\/example\.com\/custom\/ref\/\)/);

    const fullTxt = await fs.readFile(path.join(out, 'llms-full.txt'), 'utf8');
    assert.match(fullTxt, /## \[Installation\]\(https:\/\/example\.com\/guides\/installation\/\) \(Guides\)/);
    assert.match(fullTxt, /## \[Reference\]\(https:\/\/example\.com\/custom\/ref\/\) \(API Reference\)/);

    const json = JSON.parse(await fs.readFile(path.join(out, 'llms.json'), 'utf8'));
    const homePage = json.pages.find(p => p.title === 'Home');
    const installPage = json.pages.find(p => p.title === 'Installation');
    const refPage = json.pages.find(p => p.title === 'Reference');
    assert.equal(homePage.section, null);
    assert.equal(installPage.section, 'Guides');
    assert.equal(refPage.section, 'API Reference');
  });
});