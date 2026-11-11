/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * The Docker image runs `docmd serve` by default: the Dockerfile's CMD and
 * HEALTHCHECK, the entrypoint's writability check, and the health check
 * script run against a real `docmd serve` (no Docker needed).
 *
 * Run: `node tests/runner.js --only=docker-serve`
 * --------------------------------------------------------------------
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setup, writeFile, runTestFile } from '../shared.js';
import { freePort, request, spawnServe, waitForHealthz, stopServe } from '../_lib/serve-harness.js';
import { safePath } from '../../packages/utils/dist/path.js';

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

const REPO = path.join(import.meta.dirname, '..', '..');
const read = (rel) => fs.readFileSync(safePath(REPO, rel), 'utf8');

/** Instructions of a Dockerfile, comments dropped and continuation lines joined. */
function instructions(dockerfile) {
  return dockerfile
    .replace(/\\\r?\n/g, ' ')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

export const test = runTestFile({
  name: 'Docker image runs docmd serve by default',
  emoji: '🐳',
  run: async () => {
    // ── Dockerfile ───────────────────────────────────────────────────────
    {
      const lines = instructions(read('docker/Dockerfile'));
      const cmds = lines.filter((l) => /^CMD\s/.test(l));
      const last = cmds.at(-1) || '';
      assert(cmds.length >= 1 && JSON.parse(last.replace(/^CMD\s+/, '')).join(' ') === 'serve --host 0.0.0.0',
        'the final CMD is ["serve", "--host", "0.0.0.0"]');
      assert(!lines.some((l) => /^CMD\s.*"dev"/.test(l)), 'no CMD runs dev');
      const entry = lines.filter((l) => /^ENTRYPOINT\s/.test(l)).at(-1) || '';
      assert(entry.includes('/usr/local/bin/docmd-entrypoint.sh'), 'the entrypoint script is kept, so the default command goes through it');
      const hc = lines.filter((l) => /^HEALTHCHECK\s/.test(l)).at(-1) || '';
      assert(hc.includes('/usr/local/bin/docmd-healthcheck.sh'), 'HEALTHCHECK runs the health check script');
      assert(lines.some((l) => /^COPY\s+docker\/docker-healthcheck\.sh\s+\/usr\/local\/bin\/docmd-healthcheck\.sh$/.test(l)), 'the health check script is copied into the image');
      assert(lines.some((l) => /^EXPOSE\s+3000$/.test(l)), 'port 3000 is exposed');
    }

    // ── Entrypoint: serve writes the site, so /docs must be writable ────
    {
      const entry = read('docker/docker-entrypoint.sh');
      const arm = entry.match(/case "\$FIRST_ARG" in\s+([^)]+)\)/);
      const commands = arm ? arm[1].split('|').map((s) => s.trim()) : [];
      assert(commands.includes('serve') && commands.includes('dev') && commands.includes('build'), 'the writability check covers serve, dev and build');
    }

    // ── Health check script against a real docmd serve ───────────────────
    {
      const script = read('docker/docker-healthcheck.sh');
      assert(/curl [^\n]*"http:\/\/127\.0\.0\.1:\$\{PORT:-3000\}\/healthz"/.test(script), 'the health check curls /healthz on ${PORT:-3000}');

      // The `dev` fallback probes ports 3000-3005, which may be taken on this
      // machine, so the runs below use a copy whose range is two free ports.
      const range = '3000 3001 3002 3003 3004 3005';
      assert(script.includes(`for port in ${range}; do`), 'the dev fallback probes ports 3000-3005');
      const [devPort, idlePort] = [await freePort(), await freePort()];
      const tmp = setup('docker-serve-healthcheck-copy');
      writeFile(tmp, 'healthcheck.sh', script.replace(range, `${devPort} ${idlePort}`));
      // Async spawn: the fake dev server below runs in this process.
      const healthcheck = (env) => new Promise((resolve) => {
        const child = spawn('sh', [safePath(tmp, 'healthcheck.sh')], { env: { ...process.env, ...env }, stdio: 'ignore' });
        child.once('exit', (code) => resolve(code));
      });

      const port = await freePort();
      const dir = setup('docker-serve-healthcheck');
      writeFile(dir, 'docmd.config.json', JSON.stringify({ title: 'T', src: 'docs', out: 'site' }));
      // No index page: GET / is 404, so only /healthz can make the check pass.
      writeFile(dir, 'docs/guide.md', '# Guide\n');
      const handle = spawnServe(dir, [], { PORT: String(port) });
      try {
        await waitForHealthz(port, handle);
        assert((await request(port, '/')).status === 404, 'the fixture site has no index page');
        assert(await healthcheck({ PORT: String(port) }) === 0, 'health check passes against docmd serve on PORT');
      } finally {
        await stopServe(handle);
      }

      const nothing = await freePort();
      assert(await healthcheck({ PORT: String(nothing) }) === 1, 'health check fails when nothing listens on PORT or the dev ports');
      const fake = http.createServer((req, res) => {
        res.writeHead(req.url === '/healthz' ? 404 : 200);
        res.end();
      });
      await new Promise((r) => fake.listen(devPort, '127.0.0.1', r));
      try {
        assert(await healthcheck({ PORT: String(nothing) }) === 0, 'health check passes for a dev server (no /healthz) on a fallback port');
      } finally {
        await new Promise((r) => fake.close(r));
      }
    }
  }
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};
