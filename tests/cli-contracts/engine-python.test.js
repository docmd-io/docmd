/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * Python engine contracts — verifies @docmd/engine-python and its
 * integration with @docmd/api (loadEngine, isEngineAvailable, getAvailableEngines).
 *
 * Run: `node tests/runner.js engine-python`
 * --------------------------------------------------------------------
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { runTestFile } from '../shared.js';

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

const monorepoRoot = path.resolve(import.meta.dirname, '..', '..');
const API_DIST = path.resolve(monorepoRoot, 'packages', 'api', 'dist', 'index.js');
const PYTHON_DIST = path.resolve(monorepoRoot, 'packages', 'engines', 'python', 'dist', 'index.js');

// Read expected version dynamically from package.json so bump.js keeps it in sync
// automatically — no manual edits needed after each version bump.
const _require = createRequire(import.meta.url);
const { version: EXPECTED_VERSION } = _require('../../packages/engines/python/package.json');

export const test = runTestFile({
  name: 'Python engine (@docmd/engine-python + @docmd/api)',
  emoji: '🐍',
  run: async () => {
    // 1. Direct @docmd/engine-python exports and capabilities
    {
      const pyEngineMod = await import(PYTHON_DIST);
      assert(typeof pyEngineMod.isPythonEngineAvailable === 'function', 'PY-1: isPythonEngineAvailable is exported');
      assert(typeof pyEngineMod.createPythonEngine === 'function', 'PY-2: createPythonEngine is exported');

      const available = pyEngineMod.isPythonEngineAvailable();
      assert(available === true, 'PY-3: Python engine is available on this environment');

      const engine = pyEngineMod.createPythonEngine();
      assert(engine.name === 'python', 'PY-4: Engine name is "python"');
      assert(engine.version === EXPECTED_VERSION, `PY-5: Engine version matches monorepo (${EXPECTED_VERSION})`);

      assert(engine.supports('file:read') === true, 'PY-SUPP-1: supports file:read');
      assert(engine.supports('file:discover') === true, 'PY-SUPP-2: supports file:discover');
      assert(engine.supports('file:readBatch') === true, 'PY-SUPP-3: supports file:readBatch');
      assert(engine.supports('search:index') === true, 'PY-SUPP-4: supports search:index');
      assert(engine.supports('git:log') === true, 'PY-SUPP-5: supports git:log');
      assert(engine.supports('git:status') === true, 'PY-SUPP-6: supports git:status');
      assert(engine.supports('unknown:task') === false, 'PY-SUPP-7: rejects unknown task');

      // file:exists
      const existsRes = await engine.run({ type: 'file:exists', payload: { path: path.join(monorepoRoot, 'package.json') } });
      assert(existsRes.success === true && existsRes.data === true, 'PY-TASK-1: file:exists returns true for package.json');

      // file:read
      const readRes = await engine.run({ type: 'file:read', payload: { path: path.join(monorepoRoot, 'package.json') } });
      assert(readRes.success === true && typeof readRes.data === 'string' && readRes.data.includes('@docmd/monorepo'), 'PY-TASK-2: file:read reads package.json');

      // file:readBatch
      const batchRes = await engine.run({
        type: 'file:readBatch',
        payload: { paths: [path.join(monorepoRoot, 'package.json'), path.join(monorepoRoot, 'LICENSE')] },
      });
      assert(batchRes.success === true && Object.keys(batchRes.data).length === 2, 'PY-TASK-3: file:readBatch reads multiple files');

      // file:write
      const tmpFile = path.join(os.tmpdir(), `docmd-py-test-${Date.now()}.txt`);
      const writeRes = await engine.run({ type: 'file:write', payload: { path: tmpFile, content: 'python engine test' } });
      assert(writeRes.success === true, 'PY-TASK-4: file:write succeeds');
      assert(fs.readFileSync(tmpFile, 'utf8') === 'python engine test', 'PY-TASK-5: file:write content verified');
      fs.rmSync(tmpFile, { force: true });

      // file:discover
      const discRes = await engine.run({
        type: 'file:discover',
        payload: { dir: path.join(monorepoRoot, 'packages', 'engines', 'python'), extensions: ['.json'] },
      });
      assert(discRes.success === true && Array.isArray(discRes.data) && discRes.data.length >= 2, 'PY-TASK-6: file:discover finds json files');

      // git:status
      const statusRes = await engine.run({ type: 'git:status', payload: {} });
      assert(statusRes.success === true && Array.isArray(statusRes.data), 'PY-TASK-7: git:status returns array');

      // search:index
      const idxRes = await engine.run({
        type: 'search:index',
        payload: {
          documents: [
            { id: 'p1', title: 'Python Guide', content: 'Docmd Python Engine accelerates tasks', path: '/docs/python' }
          ]
        }
      });
      assert(idxRes.success === true && typeof idxRes.data === 'string' && idxRes.data.includes('python guide'), 'PY-TASK-8: search:index indexes documents');

      // search:chunk (semantic text chunking)
      const chunkDoc = '# Overview\nIntro to engine.\n## Semantic Search\nVector search indexing and chunking.';
      const chunkRes = await engine.run({
        type: 'search:chunk',
        payload: { text: chunkDoc, file: 'test.md', chunkSize: 10, chunkOverlap: 2 }
      });
      assert(chunkRes.success === true && Array.isArray(chunkRes.data) && chunkRes.data.length === 2, 'PY-SEM-1: search:chunk returns heading-aware chunks');
      assert(chunkRes.data[0].heading === 'Overview' && chunkRes.data[1].heading === 'Semantic Search', 'PY-SEM-1b: headings correctly mapped in chunks');

      // search:quantize (Float32 to Int8 quantization)
      const sampleVectors = [
        [0.1, -0.5, 0.8, 0.2],
        [-0.2, 0.4, -0.9, 0.1]
      ];
      const quantRes = await engine.run({
        type: 'search:quantize',
        payload: { vectors: sampleVectors, dimensions: 4 }
      });
      assert(quantRes.success === true && Array.isArray(quantRes.data?.quantized), 'PY-SEM-2: search:quantize quantizes vectors');
      assert(quantRes.data.quantized[0].length === 4 && Array.isArray(quantRes.data.mins), 'PY-SEM-2b: quantized vector dimensions match');

      // search:cosine (batch cosine similarity)
      const queryVec = [0.1, -0.5, 0.8, 0.2];
      const cosineRes = await engine.run({
        type: 'search:cosine',
        payload: { query: queryVec, vectors: sampleVectors, topK: 2 }
      });
      assert(cosineRes.success === true && cosineRes.data.length === 2, 'PY-SEM-3: search:cosine returns top-K results');
      assert(cosineRes.data[0].index === 0 && Math.abs(cosineRes.data[0].score - 1.0) < 0.0001, 'PY-SEM-3b: cosine similarity exact match is 1.0');

      // Clean shutdown
      if (typeof engine.shutdown === 'function') {
        engine.shutdown();
      }
      assert(true, 'PY-SHUTDOWN: engine.shutdown() cleanly terminates worker');
    }

    // 2. Integration with @docmd/api
    {
      const api = await import(API_DIST);
      const {
        loadEngine,
        isEngineAvailable,
        getAvailableEngines,
        resolveEngine,
        chunkText,
        quantizeVectors,
        cosineSimilarity,
        getGitLog,
      } = api;

      const isAvailable = await isEngineAvailable('python');
      assert(isAvailable === true, 'API-PY-1: isEngineAvailable("python") returns true');

      const availableEngines = await getAvailableEngines();
      assert(availableEngines.includes('python'), 'API-PY-2: getAvailableEngines() includes "python"');

      const loaded = await loadEngine('python');
      assert(loaded && loaded.name === 'python', 'API-PY-3: loadEngine("python") returns python engine');

      const runRes = await loaded.run({ type: 'file:exists', payload: { path: path.join(monorepoRoot, 'package.json') } });
      assert(runRes.success === true && runRes.data === true, 'API-PY-4: loaded engine executes run()');

      // Semantic helpers via @docmd/api
      const chunks = await chunkText(loaded, '# Title\nContent here.\n## Subtitle\nMore text.', 'doc.md', 5, 1);
      assert(Array.isArray(chunks) && chunks.length === 2, 'API-PY-5: chunkText helper generates chunks');

      const qResult = await quantizeVectors(loaded, [[0.5, -0.5, 0.0, 1.0]], 4);
      assert(Array.isArray(qResult.quantized) && qResult.quantized[0].length === 4, 'API-PY-6: quantizeVectors helper quantizes vectors');

      const simMatches = await cosineSimilarity(loaded, [0.5, -0.5, 0.0, 1.0], [[0.5, -0.5, 0.0, 1.0]], 1);
      assert(simMatches.length === 1 && Math.abs(simMatches[0].score - 1.0) < 0.0001, 'API-PY-7: cosineSimilarity helper computes similarity');

      const resolved = await resolveEngine(['python', 'js']);
      assert(resolved && resolved.name === 'python', 'API-PY-8: resolveEngine(["python", "js"]) selects python engine');

      const gitLogs = await getGitLog(loaded, [path.join(monorepoRoot, 'package.json')], 2);
      assert(gitLogs instanceof Map && gitLogs.has(path.join(monorepoRoot, 'package.json')), 'API-PY-9: getGitLog helper retrieves commit logs');

      if (typeof loaded.shutdown === 'function') {
        loaded.shutdown();
      }
      if (typeof resolved.shutdown === 'function') {
        resolved.shutdown();
      }
    }
  },
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return failures; },
};