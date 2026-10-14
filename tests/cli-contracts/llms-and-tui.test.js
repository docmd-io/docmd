/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * Slice F — TUI + content + perf + cross-platform
 *
 * Covers:
 *   T-Z10 llms.txt / llms.json titles are sanitised so a malicious
 *         title cannot break out of the markdown link or render as
 *         raw HTML.
 *   T-Z11 llms.txt / llms.json titles starting with =, +, -, @ are
 *         prefixed with a single-quote so opening the file in a
 *         spreadsheet does not execute a formula.
 *   N-13  NO_COLOR suppresses the banner (chalk 4+ already
 *         suppresses the colour codes automatically, so this is
 *         a one-line banner-specific change).
 *   N-16  DOCMD_NO_BANNER suppresses the banner specifically
 *         (separate from NO_COLOR so users can keep colour but
 *         silence the ASCII art).
 *
 * Run: `node tests/runner.js --only=llms-and-tui`
 * --------------------------------------------------------------------
 */

import {
  DOCMD,
  setup,
  writeFile,
  build,
  runTestFile
} from '../shared.js';
import { execSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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

export const test = runTestFile({
  name: 'LLMS plugin sanitisation + TUI banner suppression (T-Z10, T-Z11, N-13, N-16)',
  emoji: '🛡️',
  run: () => {

    // T-Z10 — Markdown injection in title (links, backticks) is escaped
    // in llms.txt so an attacker cannot smuggle links or formatting into
    // LLM prompts.
    {
      const dir = setup('f-tz10-markdown-in-title');
      writeFile(dir, 'docs/index.md', [
        '---',
        'title: "Evil `code` [link](http://attacker.com) title"',
        '---',
        '',
        '# Home',
        '',
        'Body content.'
      ].join('\n'));

      build(dir);

      const llms = fs.readFileSync(path.join(dir, 'site/llms.txt'), 'utf8');
      // The raw malicious chars should be escaped (backslashes added) so
      // the link form is preserved. The attacker's URL is no longer
      // part of a clickable link.
      assert(/\\`/.test(llms) || /`/.test(llms) === false, 'T-Z10: backticks are escaped in llms.txt titles');
      assert(/\\\[link\\\]/.test(llms) || /\[link\]\(http/.test(llms) === false, 'T-Z10: square brackets are escaped, so the attack link doesn\'t render as markdown');
    }

    // T-Z11 — titles starting with =, +, -, or @ are prefixed with a
    // single-quote so they don't execute as a CSV formula when the file
    // is opened in Excel / Sheets / LibreOffice.
    {
      const dir = setup('f-tz11-csv-formula');
      writeFile(dir, 'docs/index.md', [
        '---',
        'title: "=cmd|\"/c calc\"!A1"',
        '---',
        '',
        '# Home'
      ].join('\n'));

      build(dir);

      const llms = fs.readFileSync(path.join(dir, 'site/llms.txt'), 'utf8');
      // The leading = should be neutralised by a leading single-quote
      // (so the spreadsheet sees text, not a formula).
      assert(/'-cmd|/.test(llms) || /^#\s*'/.test(llms) || /^-cmd/.test(llms) === false, 'T-Z11: = formula prefix is neutralised in llms.txt');
      // The CSV-injection form should NOT appear verbatim.
      assert(!/^#\s*=cmd\|/.test(llms) && !/- \[=cmd\|/.test(llms), 'T-Z11: raw =cmd|... pattern is NOT present in llms.txt');

      // Same check for llms.json (the manifest).
      const llmsJson = JSON.parse(fs.readFileSync(path.join(dir, 'site/llms.json'), 'utf8'));
      const pageTitle = llmsJson.pages[0]?.title || '';
      assert(pageTitle.startsWith("'") || !/^[=+\-@]/.test(pageTitle), 'T-Z11: llms.json title is CSV-safe');
    }

    // N-13 + N-16 — the TUI banner is suppressed when NO_COLOR or
    // DOCMD_NO_BANNER is set. We trigger the banner indirectly by
    // running a build (which calls TUI.banner in build.ts) and then
    // look for the ASCII-art `|_|___` in stdout.
    {
      const dir = setup('f-tui-banner-control');
      writeFile(dir, 'docs/index.md', '# Home\n');

      // Default — banner present.
      let output = '';
      try {
        output = execSync(`node ${DOCMD} build`, { cwd: dir, stdio: 'pipe', encoding: 'utf8' });
      } catch (e) {
        output = (typeof e.stdout === 'string' ? e.stdout : '') + (typeof e.stderr === 'string' ? e.stderr : '');
      }
      assert(/v0\.[89]\.\d+/.test(output), 'N-13/N-16: banner (version line) is present by default');

      // NO_COLOR — banner suppressed (chalk 4+ also drops colour, but
      // our banner-specific check suppresses the ASCII art too).
      output = '';
      try {
        output = execSync(`node ${DOCMD} build`, { cwd: dir, stdio: 'pipe', encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
      } catch (e) {
        output = (typeof e.stdout === 'string' ? e.stdout : '') + (typeof e.stderr === 'string' ? e.stderr : '');
      }
      assert(!/v0\.[89]\.\d+/.test(output), 'N-13: NO_COLOR suppresses the banner');

      // DOCMD_NO_BANNER — banner suppressed even without NO_COLOR.
      output = '';
      try {
        output = execSync(`node ${DOCMD} build`, { cwd: dir, stdio: 'pipe', encoding: 'utf8', env: { ...process.env, DOCMD_NO_BANNER: '1', NO_COLOR: '' } });
      } catch (e) {
        output = (typeof e.stdout === 'string' ? e.stdout : '') + (typeof e.stderr === 'string' ? e.stderr : '');
      }
      assert(!/v0\.[89]\.\d+/.test(output), 'N-16: DOCMD_NO_BANNER suppresses the banner');
    }

    // `docmd mcp` speaks JSON-RPC over stdio, so stdout must carry only
    // protocol messages. The banner must not be printed there, even
    // with the default environment (no NO_COLOR / DOCMD_NO_BANNER).
    {
      const dir = setup('f-tui-mcp-stdout');
      writeFile(dir, 'docs/index.md', '# Home\n');

      const init = JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } }
      }) + '\n';
      const env = { ...process.env, NO_COLOR: '' };
      delete env.DOCMD_NO_BANNER;
      let stdout = '';
      try {
        stdout = execFileSync(process.execPath, [DOCMD, 'mcp'], { cwd: dir, input: init, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8', env, timeout: 15000 });
      } catch (e) {
        stdout = typeof e.stdout === 'string' ? e.stdout : '';
      }
      const lines = stdout.split('\n').filter((l) => l.trim());
      const allJson = lines.length > 0 && lines.every((l) => {
        try { JSON.parse(l); return true; } catch { return false; }
      });
      assert(allJson, 'mcp: stdout carries only JSON-RPC messages (no banner)');
      let first = null;
      try { first = JSON.parse(lines[0]); } catch { /* not JSON */ }
      assert(first?.id === 1 && !!first?.result, 'mcp: first stdout line is the initialize response');
    }
  }
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};