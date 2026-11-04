/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * MCP `read_doc` reads only markdown inside the configured source
 * directory and refuses pages matched by `config.exclude`.
 *
 * Run: `node tests/runner.js --only=mcp-read-doc`
 * --------------------------------------------------------------------
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setup, writeFile, runTestFile, DOCMD } from '../shared.js';
import { resolveReadDocRoute } from '../../packages/core/dist/commands/mcp.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) {
    failed++;
    failures.push(message);
    console.log(`    ❌ ${message}`);
  } else {
    passed++;
    console.log(`    ✅ ${message}`);
  }
}

function callMcp(cwd, messages) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [DOCMD, 'mcp'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    const responses = new Map();
    let buf = '';
    const timer = setTimeout(() => { proc.kill('SIGTERM'); resolve(responses); }, 15000);
    proc.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.id != null) responses.set(msg.id, msg);
        } catch { /* non-JSON line */ }
      }
      if (responses.size >= messages.length) {
        clearTimeout(timer);
        proc.kill('SIGTERM');
        resolve(responses);
      }
    });
    proc.on('error', reject);
    for (const m of messages) proc.stdin.write(JSON.stringify(m) + '\n');
    proc.stdin.end();
  });
}

export const test = runTestFile({
  name: 'MCP read_doc confines reads to markdown in the source dir',
  emoji: '📖',
  run: async () => {
    const dir = setup('mcp-read-doc');
    writeFile(dir, 'docmd.config.json', JSON.stringify({ title: 'T', exclude: ['secret.md', 'drafts/*.md'] }));
    writeFile(dir, '.env', 'SECRET=1\n');
    writeFile(dir, 'docs/intro.md', '# Intro content\n');
    writeFile(dir, 'docs/a.markdown', '# A\n');
    writeFile(dir, 'docs/notes.txt', 'notes\n');
    writeFile(dir, 'docs/secret.md', '# Secret\n');
    writeFile(dir, 'docs/drafts/a.md', '# Draft\n');
    writeFile(dir, 'docs/.hidden/x.md', '# Hidden\n');
    let symlinked = true;
    try { fs.symlinkSync(path.join(dir, '.env'), path.join(dir, 'docs/link.md')); } catch { symlinked = false; }
    writeFile(dir, 'docs-private/x.md', '# Private\n');
    writeFile(dir, 'x.md', '# Root\n');

    const opts = { cwd: dir, docsDir: path.join(dir, 'docs'), exclude: ['secret.md', 'drafts/*.md'] };
    const table = [
      ['docs/intro.md', true],
      ['docs/a.markdown', true],
      ['docs/notes.txt', false],
      ['.env', false],
      ['x.md', false],
      ['docs-private/x.md', false],
      ['docs/secret.md', false],
      ['docs/drafts/a.md', false],
      ['docs/.hidden/x.md', false],
      ...(symlinked ? [['docs/link.md', false]] : []),
      ['../x.md', false],
    ];
    for (const [route, ok] of table) {
      const r = resolveReadDocRoute(route, opts);
      assert(r.ok === ok, `rule: "${route}" -> ${ok ? 'ok' : 'error'}${r.ok ? '' : ` (${r.error})`}`);
    }
    const outside = resolveReadDocRoute('.env', opts);
    assert(
      !outside.ok && outside.error === 'Error: Path ".env" is outside the documentation source directory.',
      'rule: outside-source error text matches the contract'
    );

    const call = (id, route) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'read_doc', arguments: { route } } });
    const responses = await callMcp(dir, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
      call(2, '.env'),
      call(3, 'docs/intro.md'),
    ]);
    const text = (id) => responses.get(id)?.result?.content?.[0]?.text || '';
    assert(/outside the documentation source directory/.test(text(2)) && !text(2).includes('SECRET'), 'stdio: read_doc ".env" returns an error, not contents');
    assert(text(3).includes('# Intro content'), 'stdio: read_doc "docs/intro.md" returns the file');
  }
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};
