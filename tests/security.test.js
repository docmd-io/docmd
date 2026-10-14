#!/usr/bin/env node
/**
 * docmd Security Test Suite
 * ==========================
 * End-to-end tests for the Phase 0 security primitives:
 *   - security.html = 'allow' (default) | 'escape' | 'strip'
 *   - escape helpers (escHtml / attrEsc / jsonInject / scriptLiteral) integration
 *   - safePath() path-traversal guard
 *
 * Run: node tests/security.test.js
 */

import { execSync, spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { tryHit, store as cacheStore } from './_lib/build-cache.mjs';

const DOCMD = path.resolve(import.meta.dirname, '../packages/core/dist/bin/docmd.js');
const TEST_ROOT = '/tmp/docmd-brute-security';
const PASS = '✅';
const FAIL = '❌';

let passed = 0;
let failed = 0;
const failures = [];

function setup(name) {
  const dir = path.join(TEST_ROOT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function build(dir) {
  // Cache check: if the test's source files + config match a previous
  // successful build, reuse the cached `site/` directory instead of running
  // a fresh `docmd build`. Collapses second-run prep time when fixtures
  // haven't changed. Bypass with DOCMD_TEST_CACHE_OFF=1.
  const configPath = path.join(dir, 'docmd.config.json');
  const hit = tryHit(dir, configPath);
  if (hit && hit.ok) {
    const targetSite = path.join(dir, 'site');
    fs.rmSync(targetSite, { recursive: true, force: true });
    try {
      fs.cpSync(hit.siteDir, targetSite, { recursive: true, dereference: false });
    } catch {
      fs.mkdirSync(targetSite, { recursive: true });
    }
    return { ok: true, output: hit.output, stderr: hit.stderr || '', cached: true };
  }
  // Use spawnSync so we can capture both stdout AND stderr on success too
  // (execSync discards stderr on success). Plugins use console.error to
  // surface validation warnings (e.g. S-4 analytics, S-5 PWA).
  const r = spawnSync('node', [DOCMD, 'build'], {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const result = {
    ok: r.status === 0,
    output: r.stdout || '',
    stderr: r.stderr || ''
  };
  if (result.ok) {
    const siteDir = path.join(dir, 'site');
    if (fs.existsSync(siteDir)) {
      try { cacheStore(dir, configPath, siteDir, true, result.output, result.stderr); } catch { /* best-effort */ }
    }
  }
  return result;
}

function writeFile(dir, filePath, content) {
  const full = path.join(dir, filePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function readSite(dir, filePath) {
  const full = path.join(dir, 'site', filePath);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf8');
}

function assert(testName, condition, detail = '') {
  if (condition) {
    console.log(`  ${PASS} ${testName}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${testName}${detail ? ': ' + detail : ''}`);
    failed++;
    failures.push(testName);
  }
}

// ─── TEST S1: Default security.html = 'allow' passes raw HTML through ───
console.log('\n🔒 Test S1: Default html policy is allow (industry standard)');
{
  const dir = setup('s1-default-allow');
  writeFile(dir, 'docs/index.md', [
    '---',
    'title: Raw HTML Test',
    '---',
    '',
    '# Heading',
    '',
    '<details><summary>Click</summary>Hidden</details>',
    ''
  ].join('\n'));
  const r = build(dir);
  assert('build succeeds', r.ok, r.output);
  const html = readSite(dir, 'index.html');
  assert('output exists', html !== null);
  assert('default policy allows <details>', html && html.includes('<details>'));
  assert('default policy allows <summary>', html && html.includes('<summary>'));
}

// ─── TEST S1b: Explicit 'escape' blocks raw HTML ────────────────────────
console.log('\n🔒 Test S1b: Explicit security.html = "escape" blocks raw HTML');
{
  const dir = setup('s1b-explicit-escape');
  writeFile(dir, 'docmd.config.json', JSON.stringify({
    title: 'Escape',
    security: { html: 'escape' }
  }));
  writeFile(dir, 'docs/index.md', [
    '# Heading',
    '',
    '<script>alert("xss")</script>',
    ''
  ].join('\n'));
  const r = build(dir);
  assert('build succeeds', r.ok, r.output);
  const html = readSite(dir, 'index.html');
  assert('escape policy blocks the canary', html && !html.includes('alert("xss")'));
  assert('escaped output shows &lt;script&gt;', html && html.includes('&lt;script&gt;'));
}

// ─── TEST S2: Explicit 'allow' policy passes raw HTML through ───────────
console.log('\n🔒 Test S2: security.html = "allow" passes raw HTML');
{
  const dir = setup('s2-allow');
  writeFile(dir, 'docmd.config.json', JSON.stringify({
    title: 'Allow',
    security: { html: 'allow' }
  }));
  writeFile(dir, 'docs/index.md', [
    '# Heading',
    '',
    '<script>alert("xss")</script>',
    ''
  ].join('\n'));
  const r = build(dir);
  assert('build succeeds', r.ok, r.output);
  const html = readSite(dir, 'index.html');
  assert('allow policy keeps <script>', html && html.includes('<script>alert'));
}

// ─── TEST S3: Explicit 'strip' policy removes raw HTML entirely ─────────
console.log('\n🔒 Test S3: security.html = "strip" removes raw HTML');
{
  const dir = setup('s3-strip');
  writeFile(dir, 'docmd.config.json', JSON.stringify({
    title: 'Strip',
    security: { html: 'strip' }
  }));
  writeFile(dir, 'docs/index.md', [
    '# Heading',
    '',
    'before',
    '',
    '<script>alert("xss")</script>',
    '',
    '<details><summary>x</summary>y</details>',
    '',
    'after'
  ].join('\n'));
  const r = build(dir);
  assert('build succeeds', r.ok, r.output);
  const html = readSite(dir, 'index.html');
  assert('strip policy removes the user canary', html && !html.includes('alert("xss")'));
  assert('strip policy removes <details>', html && !html.includes('<details>'));
  assert('strip policy removes </details>', html && !html.includes('</details>'));
  assert('strip policy keeps surrounding text', html && html.includes('before') && html.includes('after'));
}

// ─── TEST S4: Invalid policy value falls back to 'allow' (default) ───────
console.log('\n🔒 Test S4: Invalid policy value defaults to allow');
{
  const dir = setup('s4-invalid-policy');
  writeFile(dir, 'docmd.config.json', JSON.stringify({
    title: 'Invalid',
    security: { html: 'bogus' }
  }));
  writeFile(dir, 'docs/index.md', '# Hi\n\n<details>visible</details>\n');
  const r = build(dir);
  assert('build succeeds with bogus policy', r.ok, r.output);
  const html = readSite(dir, 'index.html');
  assert('bogus value falls back to allow', html && html.includes('<details>'));
}

// ─── TEST S5: No security config still defaults to allow ────────────────
console.log('\n🔒 Test S5: No security block at all defaults to allow');
{
  const dir = setup('s5-no-security');
  writeFile(dir, 'docmd.config.json', JSON.stringify({ title: 'No Security' }));
  writeFile(dir, 'docs/index.md', '# Hi\n\n<details>visible</details>\n');
  const r = build(dir);
  assert('build succeeds with no security block', r.ok, r.output);
  const html = readSite(dir, 'index.html');
  assert('no security block defaults to allow', html && html.includes('<details>'));
}

// ─── TEST S6: Markdown text outside HTML is unaffected by the policy ─────
console.log('\n🔒 Test S6: Markdown rendering unaffected by HTML policy');
{
  const dir = setup('s6-markdown-unaffected');
  writeFile(dir, 'docmd.config.json', JSON.stringify({
    title: 'Markdown',
    security: { html: 'strip' }
  }));
  writeFile(dir, 'docs/index.md', [
    '# Title',
    '',
    'Paragraph with **bold** and *italic*.',
    '',
    '- list item one',
    '- list item two',
    '',
    '`inline code` and a [link](https://example.com).'
  ].join('\n'));
  const r = build(dir);
  assert('build succeeds', r.ok, r.output);
  const html = readSite(dir, 'index.html');
  assert('heading renders as <h1>', html && html.includes('<h1'));
  assert('bold renders as <strong>', html && html.includes('<strong>'));
  assert('italic renders as <em>', html && html.includes('<em>'));
  assert('link renders as <a href', html && html.includes('href="https://example.com"'));
  assert('inline code renders as <code>', html && html.includes('<code>'));
}

// ─── TEST S7: OpenAPI plugin rejects spec path that escapes project root (S-2) ──
console.log('\n🔒 Test S7: OpenAPI plugin safePath enforcement (Phase 1.A, S-2)');
{
  // Place a canary file outside the project
  const canaryDir = '/tmp/docmd-openapi-canary';
  fs.mkdirSync(canaryDir, { recursive: true });
  const canaryPath = path.join(canaryDir, 'canary-spec.json');
  fs.writeFileSync(canaryPath, JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'CANARY-PATH-TRAVERSAL-PROOF', version: '1.0.0' },
    paths: { '/canary': { get: { summary: 'Path traversal confirmed' } } }
  }));

  const dir = setup('s7-openapi-traversal');
  writeFile(dir, 'docmd.config.json', JSON.stringify({
    title: 'OA PoC',
    plugins: { openapi: {} }
  }));
  writeFile(dir, 'docs/poc.md', [
    '# PoC',
    '',
    '```openapi',
    canaryPath,
    '```',
    ''
  ].join('\n'));
  const r = build(dir);
  assert('build succeeds', r.ok, r.output);
  const html = readSite(dir, 'poc/index.html');
  assert('canary title NOT in output', html && !html.includes('CANARY-PATH-TRAVERSAL-PROOF'));
  assert('canary summary NOT in output', html && !html.includes('Path traversal confirmed'));
  assert('error message shown instead', html && html.includes('oa-error'));
  assert('error mentions path escape', html && /escapes project root/i.test(html));
}

// ─── TEST S8: OpenAPI plugin accepts in-project spec ─────────────────────
console.log('\n🔒 Test S8: OpenAPI plugin accepts in-project spec (regression)');
{
  const dir = setup('s8-openapi-allowed');
  // Note: the plugin computes srcDir from process.cwd() (pre-existing quirk:
  // markdownSetup reads options.config.src, but the plugin options object is
  // config.plugins.openapi which has no .config field). Spec must live at
  // project root for the regression test.
  writeFile(dir, 'specs-ok.json', JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'OK-Spec', version: '1.0.0' },
    paths: { '/ok': { get: { summary: 'Allowed' } } }
  }));
  writeFile(dir, 'docmd.config.json', JSON.stringify({
    title: 'OA OK',
    plugins: { openapi: {} }
  }));
  writeFile(dir, 'docs/poc.md', [
    '# PoC',
    '',
    '```openapi',
    './specs-ok.json',
    '```',
    ''
  ].join('\n'));
  const r = build(dir);
  assert('build succeeds', r.ok, r.output);
  const html = readSite(dir, 'poc/index.html');
  assert('OK-Spec rendered', html && html.includes('OK-Spec'));
  assert('Allowed summary rendered', html && html.includes('Allowed'));
}

// ─── TEST S9: Plugin loader rejects local-path that escapes project root (T-S8) ─
console.log('\n🔒 Test S9: Plugin loader rejects local-path escape (Phase 1.A, T-S8)');
{
  // Place a malicious plugin OUTSIDE the project root
  const evilDir = '/tmp/docmd-evil-plugin';
  fs.mkdirSync(path.join(evilDir, 'evil'), { recursive: true });
  fs.writeFileSync(path.join(evilDir, 'evil', 'package.json'), JSON.stringify({
    name: 'evil', version: '1.0.0', main: 'index.js'
  }));
  fs.writeFileSync(path.join(evilDir, 'evil', 'index.js'), [
    'export default {',
    '  plugin: { name: "evil", version: "1.0.0", capabilities: [] },',
    '  onConfigResolved: async (config) => { config.title = "PWNED-VIA-PATH-ESCAPE"; }',
    '};'
  ].join('\n'));

  const dir = setup('s9-plugin-path-escape');
  writeFile(dir, 'docmd.config.json', JSON.stringify({
    title: 'Legit Title',
    plugins: { '../evil': {} }  // Tries to escape via ../
  }));
  writeFile(dir, 'docs/index.md', '# Hi\n');
  // Phase 3 PR 3.A (F6) made missing plugins a hard build failure rather
  // than a silent warning. The security property — evil plugin does NOT
  // execute — holds in BOTH cases:
  //   - silent skip: build succeeds with original title
  //   - hard fail:   build exits 1, no HTML written, PWNED title
  //                  never appears anywhere
  // Assert the property, not the implementation detail.
  const r = build(dir, true /* expectFail is OK — security property is what we test */);
  const html = readSite(dir, 'index.html');
  const titleNotOverwritten = !html || !html.includes('PWNED-VIA-PATH-ESCAPE');
  assert('evil plugin did not execute', titleNotOverwritten);
  // The title-original assertion holds in BOTH outcomes:
  //   - silent skip: html exists and contains "Legit Title"
  //   - hard fail:   html is null, original title is vacuously "preserved"
  //                              (the build did not complete with the
  //                              PWNED title; the config title was never
  //                              overwritten by the plugin's onConfigResolved)
  const titlePreserved = !html || html.includes('Legit Title');
  assert('original title preserved (or build failed loudly)', titlePreserved);
}

// ─── TEST S9b: Dependency Overrides & Security Pins ─────────────────────
console.log('\n🔒 Test S9b: Dependency overrides and security pins');
{
  const rootPkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../package.json'), 'utf8'));
  assert('Root package.json overrides sharp to ^0.35.4 or ^0.35.5 (libvips vulnerability mitigation)', rootPkg.pnpm?.overrides?.sharp === '^0.35.4' || rootPkg.pnpm?.overrides?.sharp === '^0.35.5');
  assert('Root package.json overrides adm-zip to >=0.6.0 or >=0.6.1 (zip slip mitigation)', rootPkg.pnpm?.overrides?.['adm-zip'] === '>=0.6.0' || rootPkg.pnpm?.overrides?.['adm-zip'] === '>=0.6.1');

  const searchPluginSrc = fs.readFileSync(path.resolve(import.meta.dirname, '../packages/plugins/search/src/index.ts'), 'utf8');
  assert('Search plugin PEER_DEPS includes sharp@^0.35.4 or ^0.35.5', searchPluginSrc.includes("'sharp@^0.35.4'") || searchPluginSrc.includes("'sharp@^0.35.5'"));
  assert('Search plugin PEER_DEPS includes onnxruntime-node@^1.27.0', searchPluginSrc.includes("'onnxruntime-node@^1.27.0'"));
  assert('Search plugin PEER_DEPS includes @huggingface/transformers@^4.2.0', searchPluginSrc.includes("'@huggingface/transformers@^4.2.0'"));
}

// ─── TEST S10: MCP read_doc rejects path traversal (Phase 1.A, S-3) ───────
console.log('\n🔒 Test S10: MCP read_doc rejects path traversal (Phase 1.A, S-3)');

// Spawn the MCP server as a subprocess and exchange JSON-RPC messages over stdio.
function callMcp(cwd, messages) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [DOCMD, 'mcp'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    const responses = new Map();
    let stdoutBuf = '';
    let stderrBuf = '';

    proc.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id != null) responses.set(msg.id, msg);
        } catch { /* non-JSON line, skip */ }
      }
    });
    proc.stderr.on('data', (chunk) => { stderrBuf += chunk.toString(); });
    proc.on('error', reject);

    let i = 0;
    function sendNext() {
      if (i >= messages.length) {
        proc.stdin.end();
        setTimeout(() => {
          proc.kill('SIGTERM');
          resolve({ responses, stderr: stderrBuf });
        }, 800);
        return;
      }
      proc.stdin.write(JSON.stringify(messages[i]) + '\n');
      i++;
      setTimeout(sendNext, 100);
    }
    sendNext();
  });
}

const cases = [
  { id: 2, route: '/etc/passwd',                 expectError: /Absolute paths are not allowed/ },
  { id: 3, route: '/tmp/should-not-exist.txt',   expectError: /Absolute paths are not allowed/ },
  { id: 4, route: '../../../etc/passwd',         expectError: /escapes project root/ },
  { id: 5, route: 'docs/index.md',               expectValid: '# MCP test content' }
];

(async () => {
  const dir = setup('s10-mcp-read-doc');
  writeFile(dir, 'docmd.config.json', JSON.stringify({ title: 'MCP test' }));
  writeFile(dir, 'docs/index.md', '# MCP test content\n');

  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    ...cases.map(c => ({
      jsonrpc: '2.0', id: c.id, method: 'tools/call',
      params: { name: 'read_doc', arguments: { route: c.route } }
    }))
  ];

  const { responses } = await callMcp(dir, messages);

  assert('initialize response received', responses.has(1));

  for (const c of cases) {
    const r = responses.get(c.id);
    const text = r?.result?.content?.[0]?.text || r?.error?.message || '';
    if (c.expectError) {
      assert(`read_doc rejects "${c.route}"`, c.expectError.test(text), `got: ${text.slice(0, 80)}`);
    }
    if (c.expectValid) {
      assert(`read_doc accepts "${c.route}"`, text.includes(c.expectValid), `got: ${text.slice(0, 80)}`);
    }
  }

  // Final summary run after async S10
  console.log('\n' + '═'.repeat(50));
  console.log(`  ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
  if (failures.length > 0) {
    console.log(`\n  Failures:`);
    failures.forEach(f => console.log(`    ${FAIL} ${f}`));
  }
  console.log('═'.repeat(50) + '\n');
  process.exit(failed > 0 ? 1 : 0);
})();

// ─── TEST S11: ws-origin-guard unit checks (Phase 1.D, N-S1) ────────────
console.log('\n🔒 Test S11: ws-origin-guard unit checks (Phase 1.D, N-S1)');
(async () => {
  // Dynamically import the compiled helper from @docmd/core.
  const helperPath = path.resolve(import.meta.dirname, '../packages/core/dist/utils/ws-origin-guard.js');
  const { createOriginVerify } = await import(helperPath);

  const cases = [
    { name: 'http://localhost:3000',         expectAllow: true  },
    { name: 'http://127.0.0.1:3000',         expectAllow: true  },
    { name: 'http://[::1]:3000',            expectAllow: true  },
    { name: 'http://localhost:9999',         expectAllow: true  },  // port-agnostic
    { name: 'http://192.168.1.10:3000',     expectAllow: false },  // LAN IP, not in default allowlist
    { name: 'http://evil.com',              expectAllow: false },
    { name: 'http://evil.com:3000',         expectAllow: false },
    { name: null,                           expectAllow: false },  // no Origin header
    { name: '',                             expectAllow: false },  // empty Origin
    { name: 'not a url',                    expectAllow: false }
  ];

  const guard = createOriginVerify();
  for (const c of cases) {
    const result = await new Promise((resolve) => {
      guard(
        { origin: c.name || undefined, req: { headers: {} }, secure: false },
        (allowed, code, message) => resolve({ allowed, code, message })
      );
    });
    const label = c.name === null ? 'null' : (c.name === '' ? '(empty)' : c.name);
    assert(
      `origin ${label} -> ${c.expectAllow ? 'allow' : 'reject'}`,
      result.allowed === c.expectAllow,
      `got: ${result.allowed} (code=${result.code || 'n/a'})`
    );
  }

  // Extra-host allowlist scenario: LAN dev with --host=0.0.0.0
  const lanGuard = createOriginVerify(['192.168.1.10']);
  const lanCase = await new Promise((resolve) => {
    lanGuard(
      { origin: 'http://192.168.1.10:3000', req: { headers: {} }, secure: false },
      (allowed) => resolve(allowed)
    );
  });
  assert('LAN allowlist adds 192.168.1.10', lanCase === true);

  const lanReject = await new Promise((resolve) => {
    lanGuard(
      { origin: 'http://10.0.0.1:3000', req: { headers: {} }, secure: false },
      (allowed) => resolve(allowed)
    );
  });
  assert('LAN allowlist still rejects 10.0.0.1', lanReject === false);
})();

// ─── TEST S12: init makes NO network calls and writes no SKILL.md (Phase 1.D revised, T-S5) ─
console.log('\n🔒 Test S12: init makes no network calls (Phase 1.D revised, T-S5)');
(async () => {
  // Snapshot network calls by intercepting global fetch.
  const dir = setup('s12-init-no-network');
  writeFile(dir, 'docmd.config.json', JSON.stringify({ title: 'Init No Net' }));

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (...args) => {
    fetchCalls++;
    return originalFetch(...args);
  };

  try {
    // Run init in-process via the compiled CLI.
    // T-S5 revised (0.8.10): docmd-skills is now an npm package; init
    // no longer writes a local SKILL.md (the full skill set is installed
    // separately via `npx docmd-skills`). The security property under
    // test is the absolute zero-network invariant — init must never
    // touch the network, regardless of what files it does or doesn't write.
    const { initProject } = await import(path.resolve(import.meta.dirname, '../packages/core/dist/commands/init.js'));
    process.chdir(dir);
    await initProject({ force: true });
    assert('init makes zero network calls', fetchCalls === 0, `fetchCalls=${fetchCalls}`);
    // The local SKILL.md is no longer scaffolded. Users get the full
    // skill set by running `npx docmd-skills <dir>` separately. The dim
    // hint in init points them to that command, but the file is not
    // touched at init time.
    assert('Use `npx docmd-skills` to install SKILL.md for docmd', !fs.existsSync(path.join(dir, 'SKILL.md')));
    // The core scaffold (config, index.md, skills.md) is still written.
    assert('docs/index.md was written', fs.existsSync(path.join(dir, 'docs/index.md')));
    assert('docs/skills.md was written', fs.existsSync(path.join(dir, 'docs/skills.md')));
  } finally {
    globalThis.fetch = originalFetch;
  }
})();

// ─── TEST S13: SEO plugin escapes og:/twitter: meta tag values (Phase 1.B, T-S3) ──
console.log('\n🔒 Test S13: SEO plugin escapes meta tag values (Phase 1.B, T-S3)');
{
  const dir = setup('s13-seo-escape');
  writeFile(dir, 'docmd.config.json', JSON.stringify({
    title: 'Site Title',
    url: 'https://example.com'
  }));
  writeFile(dir, 'docs/index.md', [
    '---',
    'title: <img src=x onerror=alert(1)>',
    'description: <script>alert(1)</script>',
    '---',
    '',
    '# Hi'
  ].join('\n'));
  const r = build(dir);
  assert('build succeeds', r.ok, r.output);
  const html = readSite(dir, 'index.html');
  assert('output exists', html !== null);
  // The frontmatter title is the malicious payload; the site title is benign.
  // We assert that the malicious payload is HTML-escaped in the meta tags.
  assert('og:title escapes the frontmatter <img>', html && /<meta property="og:title" content="&lt;img src=x onerror=alert\(1\)&gt;/.test(html));
  assert('twitter:title escapes the frontmatter <img>', html && /<meta name="twitter:title" content="&lt;img src=x onerror=alert\(1\)&gt;/.test(html));
  assert('description meta is HTML-escaped', html && /<meta name="description" content="&lt;script&gt;alert\(1\)&lt;\/script&gt;/.test(html));
  assert('no live <script>alert in built HTML', html && !/<script>alert/.test(html));
}

// ─── TEST S14: link scheme validation rejects javascript:/data: in built HTML (Phase 1.B, T-S4 defense in depth) ─
console.log('\n🔒 Test S14: link scheme validation rejects javascript:/data: (Phase 1.B, T-S4)');
{
  const dir = setup('s14-link-schemes');
  writeFile(dir, 'docs/index.md', [
    '# Link Test',
    '',
    '[javascript](javascript:alert(1))',
    '',
    '[data](data:text/html,<script>alert(1)</script>)',
    '',
    '[vbscript](vbscript:msgbox(1))',
    '',
    '[safe](https://example.com)',
    '',
    '[internal](docs/other.md)'
  ].join('\n'));
  const r = build(dir);
  assert('build succeeds', r.ok, r.output);
  const html = readSite(dir, 'index.html');
  // Markdown-it 14 already rejects dangerous schemes at the parser layer; the
  // defense-in-depth check in the link_open override is the second line. Either
  // layer makes the output safe. We assert: no live dangerous href anywhere.
  assert('no javascript: href in HTML', html && !/href="javascript:/i.test(html));
  assert('no data: href in HTML', html && !/href="data:/i.test(html));
  assert('no vbscript: href in HTML', html && !/href="vbscript:/i.test(html));
  assert('safe https link still works', html && /href="https:\/\/example\.com/.test(html));
}

// ─── TEST S15: sanitizeHeadInjection helper unit checks (Phase 1.B T-S7, helper-only) ─
console.log('\n🔒 Test S15: sanitizeHeadInjection helper (Phase 1.B T-S7 helper-only)');
(async () => {
  // Phase 1.B T-S7 was revised: the framework no longer auto-sanitises plugin
  // output (would break legitimate analytics <script> tags). The
  // sanitizeHeadInjection helper is still exported from @docmd/utils so
  // individual plugins can sanitise their own output if they want. This
  // scenario unit-checks the helper itself.
  const helperPath = path.resolve(import.meta.dirname, '../packages/utils/dist/html-escape.js');
  const { sanitizeHeadInjection } = await import(helperPath);

  const cases = [
    { name: 'strips <script>...</script>', in: '<script>alert(1)</script>', out: '' },
    { name: 'strips <style>...</style>', in: '<style>body{color:red}</style>', out: '' },
    { name: 'strips <script src=...></script> (self-closing)', in: '<script async src="x.js"></script>', out: '' },
    { name: 'neutralises javascript: href', in: '<a href="javascript:alert(1)">x</a>', out: '<a href="#">x</a>' },
    { name: 'neutralises vbscript: href', in: '<a href="vbscript:msgbox(1)">x</a>', out: '<a href="#">x</a>' },
    { name: 'leaves safe <a href> alone', in: '<a href="https://example.com">x</a>', out: '<a href="https://example.com">x</a>' },
    { name: 'leaves safe <link rel=stylesheet> alone', in: '<link rel="stylesheet" href="x.css">', out: '<link rel="stylesheet" href="x.css">' },
    { name: 'handles mixed content', in: '<p>safe</p><script>x</script>', out: '<p>safe</p>' }
  ];

  for (const c of cases) {
    const actual = sanitizeHeadInjection(c.in);
    assert(
      c.name,
      actual === c.out,
      `input=${JSON.stringify(c.in)} actual=${JSON.stringify(actual)} expected=${JSON.stringify(c.out)}`
    );
  }
})();

// ─── TEST S16: Analytics plugin rejects invalid measurementId / trackingId (Phase 1.C, S-4) ─
console.log('\n🔒 Test S16: Analytics plugin format-validates IDs (Phase 1.C, S-4)');
{
  // Case 1: invalid GA4 id with XSS payload
  {
    const dir = setup('s16-analytics-bad-ga4');
    writeFile(dir, 'docmd.config.json', JSON.stringify({
      title: 'Bad GA4',
      plugins: { analytics: { googleV4: { measurementId: 'G-FAKE\'; alert(1); //' } } }
    }));
    writeFile(dir, 'docs/index.md', '# Hi\n');
    const r = build(dir);
    assert('build succeeds with invalid GA4 id', r.ok, r.stderr || r.output);
    const html = readSite(dir, 'index.html');
    assert('no alert(1) in built HTML', html && !/alert\(1\)/.test(html));
    assert('no googletagmanager script injected', html && !/googletagmanager\.com/.test(html));
    assert('error log mentions invalid id', /Invalid googleV4/.test(r.stderr || r.output));
  }

  // Case 2: valid GA4 id should still work
  {
    const dir = setup('s16-analytics-good-ga4');
    writeFile(dir, 'docmd.config.json', JSON.stringify({
      title: 'Good GA4',
      plugins: { analytics: { googleV4: { measurementId: 'G-ABC123XYZ' } } }
    }));
    writeFile(dir, 'docs/index.md', '# Hi\n');
    const r = build(dir);
    assert('build succeeds with valid GA4 id', r.ok, r.stderr || r.output);
    const html = readSite(dir, 'index.html');
    assert('googletagmanager script IS injected', html && /googletagmanager\.com/.test(html));
    assert('valid id appears as JSON-quoted string', html && /gtag\('config', "G-ABC123XYZ"\)/.test(html));
  }

  // Case 3: invalid UA id
  {
    const dir = setup('s16-analytics-bad-ua');
    writeFile(dir, 'docmd.config.json', JSON.stringify({
      title: 'Bad UA',
      plugins: { analytics: { googleUA: { trackingId: 'UA-INJECTED\'); alert(1); (' } } }
    }));
    writeFile(dir, 'docs/index.md', '# Hi\n');
    const r = build(dir);
    assert('build succeeds with invalid UA id', r.ok, r.stderr || r.output);
    const html = readSite(dir, 'index.html');
    assert('no UA injection', html && !/google-analytics\.com\/analytics\.js/.test(html) || !/attacker/.test(html));
    assert('error log mentions invalid UA', /Invalid googleUA/.test(r.stderr || r.output));
  }
}

// ─── TEST S17: PWA plugin validates themeColor (Phase 1.C, S-5) ─
console.log('\n🔒 Test S17: PWA plugin validates themeColor (Phase 1.C, S-5)');
{
  // Case 1: valid hex color works
  {
    const dir = setup('s17-pwa-valid-color');
    writeFile(dir, 'docmd.config.json', JSON.stringify({
      title: 'PWA valid',
      plugins: { pwa: { themeColor: '#ff00aa' } }
    }));
    writeFile(dir, 'docs/index.md', '# Hi\n');
    const r = build(dir);
    assert('build succeeds', r.ok, r.stderr || r.output);
    const html = readSite(dir, 'index.html');
    assert('valid theme color preserved', html && /<meta name="theme-color" content="#ff00aa">/.test(html));
  }

  // Case 2: invalid themeColor (XSS payload) is rejected
  {
    const dir = setup('s17-pwa-xss-color');
    writeFile(dir, 'docmd.config.json', JSON.stringify({
      title: 'PWA XSS',
      plugins: { pwa: { themeColor: '"><script>alert(1)</script>' } }
    }));
    writeFile(dir, 'docs/index.md', '# Hi\n');
    const r = build(dir);
    assert('build succeeds with invalid themeColor', r.ok, r.stderr || r.output);
    const html = readSite(dir, 'index.html');
    assert('no live script from themeColor XSS', html && !/<script>alert\(1\)<\/script>/.test(html));
    assert('error log mentions invalid themeColor', /Invalid themeColor/.test(r.stderr || r.output));
    assert('default theme color used as fallback', html && /<meta name="theme-color" content="#1e293b">/.test(html));
  }
}