/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * `--host` is a parsed CLI option: `docmd dev --host 0.0.0.0` binds all
 * interfaces, `docmd --help` lists it, and the dev server keeps its
 * wrapper contract (injected `window.__docmd_dev`, no-cache on `/`).
 *
 * Run: `node tests/runner.js --only=host-flag`
 * --------------------------------------------------------------------
 */

import { setup, writeFile, runTestFile, DOCMD } from '../shared.js';
import { spawn, execFileSync } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import http from 'node:http';

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

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
  });
}

async function waitForHttp(port, child, output, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`dev server exited early (${child.exitCode}): ${output.text}`);
    try {
      const res = await get(port, '/');
      if (res.status === 200) return res;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`dev server did not answer GET / on port ${port} in time; output: ${output.text}`);
}

function canConnect(host, port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
  });
}

function lanIPv4() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return null;
}

export const test = runTestFile({
  name: 'Dev --host flag binds the requested interface',
  emoji: '🌐',
  run: async () => {
    // help: `--host` is listed.
    {
      const help = execFileSync(process.execPath, [DOCMD, '--help'], { encoding: 'utf8' });
      assert(/--host/.test(help), '`docmd --help` lists --host');
    }

    // A valueless --host is rejected instead of being passed to listen().
    const novalueDir = setup('host-flag-novalue');
    const anyPort = String(await freePort());
    for (const argv of [['dev', '--host'], ['dev', '--host', '--port', anyPort]]) {
      let code = 0;
      let err = '';
      try {
        execFileSync(process.execPath, [DOCMD, ...argv], { encoding: 'utf8', stdio: 'pipe', cwd: novalueDir, timeout: 5000 });
      } catch (e) {
        code = e.status;
        err = String(e.stderr);
      }
      assert(code === 1 && /--host requires a value/.test(err), `--host without a value exits 1 with a message (${argv.slice(1).join(' ')})`);
    }

    // bind + dev wrapper: one dev spawn, reused.
    {
      const dir = setup('host-flag-dev');
      writeFile(dir, 'docs/index.md', '# Hi\n');
      writeFile(dir, 'docmd.config.json', JSON.stringify({ title: 'Host', src: './docs', out: './site' }, null, 2) + '\n');

      const port = await freePort();
      const env = { ...process.env };
      delete env.DOCMD_HOST;
      delete env.DOCMD_PROJECT_OUT;
      const child = spawn(process.execPath, [DOCMD, 'dev', '--host', '0.0.0.0', '--port', String(port)], {
        cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe']
      });
      const output = { text: '' };
      child.stdout.on('data', (c) => { output.text += c; });
      child.stderr.on('data', (c) => { output.text += c; });
      const exited = new Promise((resolve) => child.once('exit', resolve));
      try {
        const root = await waitForHttp(port, child, output);

        const lan = lanIPv4();
        if (lan) {
          assert(await canConnect(lan, port), `dev --host 0.0.0.0 accepts a connection on ${lan}:${port}`);
        } else {
          assert(false, 'no non-loopback IPv4 interface; cannot verify --host binding');
        }

        assert(root.body.includes('window.__docmd_dev'), 'GET / injects window.__docmd_dev');
        assert(root.body.includes('/__dev/docmd-api.js'), 'GET / references /__dev/docmd-api.js');
        assert(/no-cache/.test(root.headers['cache-control'] || ''), 'GET / carries Cache-Control: no-cache');
        const api = await get(port, '/__dev/docmd-api.js');
        assert(api.status === 200, 'GET /__dev/docmd-api.js is 200');
      } finally {
        child.kill('SIGTERM');
        await exited;
      }
    }
  }
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};
