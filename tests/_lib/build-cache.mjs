/**
 * Build cache for the integration test suite.
 *
 * Each test in feature-integration.test.js spawns its own `docmd build`
 * against a temp directory. The build is deterministic given the input
 * files + config, so a content-hash keyed cache lets us skip rebuilds
 * when nothing has changed between runner invocations.
 *
 * Storage layout:
 *   $TMPDIR/docmd-test-cache/<hash>/
 *     output.json           - { ok, output }
 *     site/                  - cached built site, reused on hit
 *
 * The cache key is sha256 of the JSON-encoded snapshot. When a test
 * runs and the snapshot matches an existing cache entry, the cached
 * `site/` is reused (the build step is skipped entirely). When it
 * misses, the test runs normally and stores its result.
 *
 * Invalidating the cache: delete $TMPDIR/docmd-test-cache, or run with
 * DOCMD_TEST_CACHE_OFF=1 to bypass it (tests run normally).
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

export const CACHE_ROOT = process.env.DOCMD_TEST_CACHE
    ? path.resolve(process.env.DOCMD_TEST_CACHE)
    : path.join(os.tmpdir(), 'docmd-test-cache');
const CACHE_OFF = process.env.DOCMD_TEST_CACHE_OFF === '1';

/**
 * Compute a deterministic snapshot of the test source. Includes every
 * regular file under `dir` plus the config text (when present) so
 * changes in the config alone also invalidate the cache.
 */
export function snapshot(dir, configPath = '') {
    let cleanConfigPath = configPath;
    let flags = '';
    if (configPath && configPath.includes('#')) {
        const parts = configPath.split('#');
        cleanConfigPath = parts[0];
        flags = parts.slice(1).join('#');
    }
    const files = {};
    const walk = (d) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'site' || entry.name === '_site' || entry.name === '.docmd' || entry.name === '_docmd-search') continue;
                walk(full);
            } else if (entry.isFile()) {
                const rel = path.relative(dir, full);
                files[rel] = crypto.createHash('sha256')
                    .update(fs.readFileSync(full))
                    .digest('hex');
            }
        }
    };
    walk(dir);
    return {
        files,
        flags,
        config: cleanConfigPath && fs.existsSync(cleanConfigPath)
            ? fs.readFileSync(cleanConfigPath, 'utf8') : ''
    };
}

function hash(snap) {
    // Sort keys for determinism before hashing — directory walk order
    // is OS-dependent, so bytewise equality needs an explicit sort.
    const sorted = {
        files: Object.fromEntries(
            Object.entries(snap.files).sort(([a], [b]) => a.localeCompare(b))
        ),
        flags: snap.flags || '',
        config: snap.config
    };
    return crypto.createHash('sha256')
        .update(JSON.stringify(sorted))
        .digest('hex');
}

function cacheDirFor(key) { return path.join(CACHE_ROOT, key); }

/**
 * Try the cache. Returns { ok, output, siteDir, hit: true } on a hit,
 * null on a miss. Skipped entirely when DOCMD_TEST_CACHE_OFF=1.
 */
export function tryHit(dir, configPath) {
    if (CACHE_OFF) return null;
    const snap = snapshot(dir, configPath);
    const key = hash(snap);
    const cachedSite = path.join(cacheDirFor(key), 'site');
    const entry = path.join(cacheDirFor(key), 'output.json');
    if (!fs.existsSync(entry) || !fs.existsSync(cachedSite) || !fs.existsSync(path.join(cachedSite, 'index.html'))) return null;
    try {
        const out = JSON.parse(fs.readFileSync(entry, 'utf8'));
        if (!out.ok) return null;  // never cache a failure — operator must see fresh runs
        return { ok: out.ok, output: out.output, stderr: out.stderr || '', siteDir: cachedSite, hit: true, key };
    } catch { return null; }
}

/**
 * Store a successful build's site + output for later cache hits.
 * The site dir is moved into the cache so the caller can re-use it
 * without copying. Subsequent cache hits will return this same siteDir.
 */
export function store(dir, configPath, siteDir, ok, output, stderr = '') {
    if (CACHE_OFF) return null;
    if (!ok) return null;
    const snap = snapshot(dir, configPath);
    const key = hash(snap);
    const target = cacheDirFor(key);
    fs.mkdirSync(target, { recursive: true });
    const targetSite = path.join(target, 'site');
    fs.rmSync(targetSite, { recursive: true, force: true });
    try {
        fs.cpSync(siteDir, targetSite, { recursive: true });
    } catch { /* cache best-effort */ }
    fs.writeFileSync(
        path.join(target, 'output.json'),
        JSON.stringify({ ok, output, stderr })
    );
    return key;
}

/** Clear the cache entirely (e.g. when schema changes). */
export function clear() {
    if (fs.existsSync(CACHE_ROOT)) {
        fs.rmSync(CACHE_ROOT, { recursive: true, force: true });
    }
}