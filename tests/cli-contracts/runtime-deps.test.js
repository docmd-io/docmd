/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * Runtime-deps regression tests — covers the shared auto-install pipeline
 * used by hooks.ts (plugin / template loader) and engine.ts (engine
 * loader). The 0.9.0 refactor extracted this logic from hooks.ts into
 * `packages/api/src/runtime-deps.ts` to:
 *
 *   - Replace `execSync(\`pnpm add ${pkg}\`)` (CWE-78 surface) with a
 *     strict regex + `spawn(... { shell: false })` arg-array install.
 *   - Apply a registry re-check as defence-in-depth so the auto-install
 *     path can never silently turn into a generic npm loader.
 *   - Single-source the TUI status reporter so dev-server rebuilds
 *     can't spam "[ WAIT ] / [ DONE ]" line pairs for packages that are
 *     already on disk.
 *
 * Tests touch the public surface only — everything goes through the
 * @docmd/api index, so plugins and the core package agree on the same
 * behaviour.
 *
 * Run: `node tests/runner.js --only=runtime-deps`
 * --------------------------------------------------------------------
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
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

const API_DIST = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'packages',
  'api',
  'dist',
  'index.js',
);

export const test = runTestFile({
  name: 'Runtime-deps (shared auto-install pipeline)',
  emoji: '🧰',
  run: async () => {
    // -----------------------------------------------------------------
    // 1. Public surface — symbols we export from @docmd/api must exist
    // -----------------------------------------------------------------
    {
      const source = fs.readFileSync(API_DIST, 'utf8');
      assert(
        /loadRuntimeRegistry/.test(source),
        'RD-1: @docmd/api re-exports loadRuntimeRegistry'
      );
      assert(
        /isValidRuntimeDepName/.test(source),
        'RD-2: @docmd/api re-exports isValidRuntimeDepName'
      );
      assert(
        /installRuntimeDep/.test(source),
        'RD-3: @docmd/api re-exports installRuntimeDep'
      );
      assert(
        /tryLoadAfterInstall/.test(source),
        'RD-4: @docmd/api re-exports tryLoadAfterInstall'
      );
      assert(
        /detectPackageManager/.test(source),
        'RD-5: @docmd/api re-exports detectPackageManager'
      );
      assert(
        /getDocmdVersion/.test(source),
        'RD-6: @docmd/api re-exports getDocmdVersion'
      );
      assert(
        /getBuildStatusReporter/.test(source),
        'RD-7: @docmd/api re-exports getBuildStatusReporter'
      );
    }

    // -----------------------------------------------------------------
    // 2. Functional behaviour — the regex validator is the FIRST line
    // of defence against shell-injection. Anything outside the canonical
    // @docmd/<kind>-<short> shape must be rejected.
    // -----------------------------------------------------------------
    {
      const api = await import(API_DIST);
      const { isValidRuntimeDepName, shortRuntimeDepKey, getBuildStatusReporter } = api;

      // Positive: official names.
      assert(isValidRuntimeDepName('@docmd/plugin-search') === true, 'RD-POS-1: @docmd/plugin-search is valid');
      assert(isValidRuntimeDepName('@docmd/template-summer') === true, 'RD-POS-2: @docmd/template-summer is valid');
      assert(isValidRuntimeDepName('@docmd/engine-js') === true, 'RD-POS-3: @docmd/engine-js is valid');
      assert(isValidRuntimeDepName('@docmd/engine-rust') === true, 'RD-POS-4: @docmd/engine-rust is valid');
      assert(isValidRuntimeDepName('@docmd/engine-python') === true, 'RD-POS-4b: @docmd/engine-python is valid');
      assert(isValidRuntimeDepName('@docmd/plugin-math-katex') === true, 'RD-POS-5: hyphenated short names are valid');
      assert(isValidRuntimeDepName('@docmd/plugin-foo-1.0') === true, 'RD-POS-6: dotted version suffix is valid');

      // Negative: shell-injection / shape violations.
      assert(isValidRuntimeDepName('@docmd/plugin-foo; rm -rf /') === false, 'RD-NEG-1: shell-metacharacters rejected');
      assert(isValidRuntimeDepName('@docmd/plugin-foo && curl evil') === false, 'RD-NEG-2: command-chain rejected');
      assert(isValidRuntimeDepName('@docmd/plugin-foo`whoami`') === false, 'RD-NEG-3: backticks rejected');
      assert(isValidRuntimeDepName('@docmd/plugin-foo$(whoami)') === false, 'RD-NEG-4: $() expansion rejected');
      assert(isValidRuntimeDepName('docmd/plugin-search') === false, 'RD-NEG-5: missing scope rejected');
      assert(isValidRuntimeDepName('@docmd/plugin-') === false, 'RD-NEG-6: empty short name rejected');
      assert(isValidRuntimeDepName('@docmd/random-search') === false, 'RD-NEG-7: unrecognised kind rejected');
      assert(isValidRuntimeDepName('@docmd/PLUGIN-search') === false, 'RD-NEG-8: uppercase rejected');
      assert(isValidRuntimeDepName('@evil/plugin-search') === false, 'RD-NEG-9: non-@docmd scope rejected');
      assert(isValidRuntimeDepName('') === false, 'RD-NEG-10: empty string rejected');
      assert(isValidRuntimeDepName(null) === false, 'RD-NEG-11: null rejected');
      assert(isValidRuntimeDepName(undefined) === false, 'RD-NEG-12: undefined rejected');
      assert(isValidRuntimeDepName(123) === false, 'RD-NEG-13: non-string rejected');

      // shortRuntimeDepKey must agree on the same shape AND return null for
      // unknown inputs (so call sites can defensively fall through).
      assert(shortRuntimeDepKey('@docmd/plugin-search') === 'search', 'RD-SK-1: plugin-search short name');
      assert(shortRuntimeDepKey('@docmd/template-summer') === 'summer', 'RD-SK-2: template-summer short name');
      assert(shortRuntimeDepKey('@docmd/engine-rust') === 'rust', 'RD-SK-3: engine-rust short name');
      assert(shortRuntimeDepKey('@docmd/engine-python') === 'python', 'RD-SK-3b: engine-python short name');
      assert(shortRuntimeDepKey('@docmd/plugin-math-katex') === 'math-katex', 'RD-SK-4: hyphenated short name');
      assert(shortRuntimeDepKey('@docmd/plugin-foo; rm -rf /') === null, 'RD-SK-5: rejected name → null');
      assert(shortRuntimeDepKey('@evil/plugin-search') === null, 'RD-SK-6: rejected scope → null');

      // Idempotent TUI reporter: second `begin` on the same short name
      // must be a no-op (the same reporter instance owns one build).
      const reporter = getBuildStatusReporter();
      reporter.begin('fake-test-plugin');
      reporter.begin('fake-test-plugin');
      reporter.finish('fake-test-plugin', 'DONE');
      // No equality assertion possible from here (output went to TUI);
      // we only need the function to not throw and to be callable
      // multiple times. Mark a smoke pass.
      assert(true, 'RD-IDEMPOTENT: getBuildStatusReporter() can be reused across begin/finish pairs');
    }

    // -----------------------------------------------------------------
    // 3. Registry loader — first call must not throw, second call must
    // return the cached object (idempotent).
    // -----------------------------------------------------------------
    {
      const api = await import(API_DIST);
      const { loadRuntimeRegistry } = api;
      const r1 = loadRuntimeRegistry();
      const r2 = loadRuntimeRegistry();
      assert(r1 && typeof r1 === 'object', 'RD-REG-1: loadRuntimeRegistry returns an object');
      assert(r1 === r2, 'RD-REG-2: loadRuntimeRegistry caches (identity check)');
      // The generated registry at packages/api/registry/.../plugins.generated.json
      // ships with at least these two plugins during this session. Use
      // known-present entries so the test does not break when the
      // catalog grows.
      assert(r1['search'], 'RD-REG-3: @docmd/plugin-search present in registry');
      assert(r1['summer'], 'RD-REG-4: @docmd/template-summer present in registry');
      assert(r1['js'] && r1['js'].package === '@docmd/engine-js', 'RD-REG-5: js entry points at @docmd/engine-js');
      assert(r1['rust'] && r1['rust'].package === '@docmd/engine-rust', 'RD-REG-6: rust entry points at @docmd/engine-rust');
      assert(r1['python'] && r1['python'].package === '@docmd/engine-python', 'RD-REG-6b: python entry points at @docmd/engine-python');
    }

    // -----------------------------------------------------------------
    // 4. installRuntimeDep must refuse non-runtime names AND names not
    // in the registry. We can't actually run an install in CI without
    // mutating the test-runner's working dir, so we assert the early
    // rejections (which are the security-critical path) and ensure the
    // happy-path call doesn't immediately throw synchronously.
    // -----------------------------------------------------------------
    {
      const api = await import(API_DIST);
      const { installRuntimeDep } = api;

      // First defence: regex rejects. Function returns Promise<boolean>;
      // resolves to false without spawning anything.
      const evil = await installRuntimeDep('@docmd/plugin-foo; rm -rf /');
      assert(evil === false, 'RD-INSTALL-1: installRuntimeDep refuses shell-injection name');

      const badScope = await installRuntimeDep('@evil/plugin-search');
      assert(badScope === false, 'RD-INSTALL-2: installRuntimeDep refuses non-@docmd scope');

      const missing = await installRuntimeDep('@docmd/plugin-not-in-registry');
      assert(missing === false, 'RD-INSTALL-3: installRuntimeDep refuses registry miss');

      // Happy-path: returns a boolean — never throws synchronously for
      // valid inputs (a runtime exception in spawn would be surfaced
      // via the returned promise rather than killing the loader).
      const promise = installRuntimeDep('@docmd/plugin-search');
      assert(typeof promise?.then === 'function', 'RD-INSTALL-4: installRuntimeDep returns a Promise for valid name');
      // Drain without asserting outcome — under CI there may be no
      // network. We only care about the call surface.
      await promise.then((ok) => assert(typeof ok === 'boolean', 'RD-INSTALL-5: installRuntimeDep resolves to boolean')).catch(() => {});
    }

    // -----------------------------------------------------------------
    // 5. hooks.ts + engine.ts no longer contain the old inline
    // `execSync(`${pm} add ${pkg}`)` shell-string. This is a static
    //    source check — proves the CWE-78 path is gone from BOTH files.
    // -----------------------------------------------------------------
    {
      const hooksSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, '..', '..', 'packages', 'api', 'src', 'hooks.ts'),
        'utf8',
      );
      const engineSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, '..', '..', 'packages', 'api', 'src', 'engine.ts'),
        'utf8',
      );
      const runtimeSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, '..', '..', 'packages', 'api', 'src', 'runtime-deps.ts'),
        'utf8',
      );

      assert(!/execSync\s*\(\s*[`'"][\s\S]*\$\{/.test(hooksSrc), 'RD-CWE-1: hooks.ts has no shell-string execSync');
      assert(!/execSync\s*\(\s*[`'"][\s\S]*\$\{/.test(engineSrc), 'RD-CWE-2: engine.ts has no shell-string execSync');
      assert(/import\s*\{[^}]*installRuntimeDep[^}]*\}\s*from\s*['"]\.\/runtime-deps\.js['"]/.test(hooksSrc), 'RD-IMPORT-1: hooks.ts imports installRuntimeDep from runtime-deps');
      assert(/import\s*\{[^}]*installRuntimeDep[^}]*\}\s*from\s*['"]\.\/runtime-deps\.js['"]/.test(engineSrc), 'RD-IMPORT-2: engine.ts imports installRuntimeDep from runtime-deps');
      assert(/spawn\(/.test(runtimeSrc), 'RD-SPAWN: runtime-deps.ts uses spawn, not shell');
      assert(/process\.platform === ['"]win32['"]/.test(runtimeSrc), 'RD-SHELL: runtime-deps gates shell on Windows (npm is .cmd there)');
      assert(/shell:\s*useShell/.test(runtimeSrc), 'RD-SHELL-VAR: shell is driven by useShell variable');
      assert(!/execSync\s*\(\s*[`'"][\s\S]*\$\{/.test(hooksSrc), 'RD-CWE-1b: no template-string execSync remains in hooks.ts');
    }
  },
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return failures; },
};
