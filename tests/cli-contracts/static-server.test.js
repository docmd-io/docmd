/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * Static file handler contracts: path safety, caching
 * headers, MIME table, HEAD, and the dev wrapper's injection.
 *
 * Run: `node tests/runner.js --only=static-server`
 * --------------------------------------------------------------------
 */

import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { setup, writeFile, runTestFile } from '../shared.js';
import { createStaticHandler } from '../../packages/core/dist/server/static.js';
import { serveStatic } from '../../packages/core/dist/utils/dev-utils.js';

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

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => handler(req, res));
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// Raw request so that paths such as `/../x` are not normalised by a client.
function request(server, method, reqPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: server.address().port, method, path: reqPath, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function rawHead(server, reqPath) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const sock = net.connect(server.address().port, '127.0.0.1', () => {
      sock.write(`HEAD ${reqPath} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
    });
    sock.on('data', (c) => chunks.push(c));
    sock.on('end', () => resolve(Buffer.concat(chunks)));
    sock.on('error', reject);
  });
}

const MIME_TABLE = [
  ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['webp', 'image/webp'], ['avif', 'image/avif'],
  ['xml', 'application/xml'], ['wasm', 'application/wasm'], ['mjs', 'text/javascript'],
  ['map', 'application/json'], ['webmanifest', 'application/manifest+json'],
  ['unknownext', 'application/octet-stream'],
];

export const test = runTestFile({
  name: 'Static handler: production serving, path safety, dev wrapper',
  emoji: '📁',
  run: async () => {
    const base = setup('static-server');
    const site = path.join(base, 'site');
    const bare = path.join(base, 'bare');
    const html404 = '<html><body><h1>custom missing</h1></body></html>';
    writeFile(site, 'index.html', '<html><body>home</body></html>');
    writeFile(site, 'page.html', '<html><body>page</body></html>');
    writeFile(site, 'dir/index.html', '<html><body>dir index</body></html>');
    writeFile(site, '404.html', html404);
    for (const [ext] of MIME_TABLE) writeFile(site, `assets/x.${ext}`, 'x');
    writeFile(base, 'site-private/secret.txt', 'SECRET');
    writeFile(bare, 'index.html', '<html><body>bare</body></html>');

    // Two servers; the `x-root: bare` test header picks the root without a second server.
    const handlers = {
      site: createStaticHandler({ rootDir: () => site }),
      bare: createStaticHandler({ rootDir: () => bare }),
      boom: createStaticHandler({ rootDir: () => site, extraRoutes: { '/boom': () => { throw new Error('boom'); } } })
    };
    const prod = await listen((req, res) => {
      const root = req.headers['x-root'];
      const handler = root === 'bare' ? handlers.bare : root === 'boom' ? handlers.boom : handlers.site;
      return handler(req, res);
    });
    const dev = await listen((req, res) => serveStatic(req, res, req.headers['x-root'] === 'bare' ? bare : site));
    const BARE = { 'x-root': 'bare' };

    try {
      // Caching + nosniff
      const ok = await request(prod, 'GET', '/page');
      const etag = ok.headers['etag'];
      assert(ok.status === 200 && ok.headers['cache-control'] === 'no-cache', '200 carries Cache-Control: no-cache');
      assert(/^W\/".+"$/.test(etag || ''), '200 carries a weak ETag');
      const cached = await request(prod, 'GET', '/page', { 'If-None-Match': etag });
      assert(cached.status === 304 && cached.body.length === 0, 'matching If-None-Match gives an empty 304');
      const redirect = await request(prod, 'GET', '/dir');
      const forbidden = await request(prod, 'GET', '/..%2f..%2fetc/passwd');
      const missing = await request(prod, 'GET', '/nope');
      for (const [label, r] of [['200', ok], ['301', redirect], ['304', cached], ['403', forbidden], ['404', missing]]) {
        assert(r.headers['x-content-type-options'] === 'nosniff', `${label} carries nosniff`);
      }

      // Traversal
      assert(forbidden.status === 403, 'encoded ../ traversal is 403');
      assert((await request(prod, 'GET', '/../docmd.config.json')).status === 403, 'raw ../ traversal is 403');
      for (const p of ['/../site-private/secret.txt', '/..%2fsite-private/secret.txt', '/%2e%2e/site-private/secret.txt']) {
        const r = await request(prod, 'GET', p);
        assert(r.status !== 200 && !r.body.toString().includes('SECRET'), `sibling-prefix attack ${p} is not served`);
      }

      // 404 / redirect / index / extensionless
      assert(missing.status === 404 && missing.body.toString() === html404, '404 body is byte-equal to 404.html');
      const plain = await request(prod, 'GET', '/nope', BARE);
      assert(plain.status === 404 && !/dev server/i.test(plain.body.toString()), 'plain 404 without 404.html has no "dev server"');
      assert(redirect.status === 301 && redirect.headers['location'] === '/dir/', '/dir redirects to /dir/');
      assert((await request(prod, 'GET', '/dir/')).body.toString().includes('dir index'), '/dir/ serves dir/index.html');
      assert(ok.body.toString().includes('page'), '/page serves page.html');

      // MIME table
      for (const [ext, expected] of MIME_TABLE) {
        const r = await request(prod, 'GET', `/assets/x.${ext}`);
        assert(r.headers['content-type'] === expected, `.${ext} is ${expected} (got ${r.headers['content-type']})`);
      }

      // A throwing extraRoute becomes a 500, not an unhandled rejection
      const boom = await request(prod, 'GET', '/boom', { 'x-root': 'boom' });
      assert(boom.status === 500, 'extraRoutes: a throwing handler answers 500');

      // HEAD mirrors GET
      const head = await request(prod, 'HEAD', '/page');
      assert(head.status === ok.status, 'HEAD: same status as GET');
      // Raw socket: Node's client discards HEAD bodies, so read the wire ourselves.
      // Node's server also enforces this itself; this pins the method contract, it cannot fail on handler code.
      const wire = await rawHead(prod, '/page');
      const sep = wire.indexOf('\r\n\r\n');
      assert(sep > 0 && wire.length - (sep + 4) === 0, 'HEAD: zero body bytes on the wire');
      assert(['content-type', 'etag', 'cache-control', 'x-content-type-options', 'content-length']
        .every((h) => head.headers[h] === ok.headers[h]), 'HEAD: same headers as GET');

      // Dev wrapper
      const devPage = (await request(dev, 'GET', '/')).body.toString();
      assert(devPage.includes('window.__docmd_dev') && devPage.includes('<script src="/__dev/docmd-api.js">'), 'dev injects __docmd_dev and the api script tag');
      const api = await request(dev, 'GET', '/__dev/docmd-api.js');
      assert(api.status === 200 && /javascript/.test(api.headers['content-type']), '/__dev/docmd-api.js is 200 JavaScript');
      assert(api.headers['cache-control'] === 'no-cache', '/__dev/docmd-api.js sends no-cache');
      assert((await request(dev, 'GET', '/')).headers['cache-control'] === 'no-cache', 'dev sends no-cache');
      const d404 = await request(dev, 'GET', '/nope', BARE);
      assert(d404.status === 404 && d404.body.toString().includes('docmd dev server'), 'dev 404 mentions "docmd dev server"');
      const devNoMatch = await request(dev, 'GET', '/page', { 'If-None-Match': etag });
      assert(devNoMatch.status === 200, 'ETag: a prod ETag does not 304 a dev-transformed page');
      const weak = await request(prod, 'GET', '/page', { 'If-None-Match': etag.replace(/^W\//, '') });
      assert(weak.status === 304, 'ETag: If-None-Match uses weak comparison');
      const absDir = await request(prod, 'GET', 'http://localhost/dir?a=1');
      assert(absDir.status === 301 && absDir.headers['location'] === '/dir/?a=1', 'absolute-form /dir redirects to /dir/ with query');
      const absForm = await request(prod, 'GET', 'http://localhost/page');
      assert(absForm.status === 200 && absForm.body.toString().includes('page'), 'absolute-form request target is served');
    } finally {
      prod.close();
      dev.close();
    }
  }
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};
