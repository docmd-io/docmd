/**
 * --------------------------------------------------------------------
 * docmd doctor : extended pre-flight diagnostics & health check command.
 *
 * Checks system environment, project configuration, markdown structure,
 * navigation integrity, plugin installation, and calls custom plugin
 * diagnostic hooks via `onDoctorCheck`.
 *
 * Flags:
 *   --fix            Auto-install missing official plugins/templates.
 *   --json           Emit the report as JSON (for tooling / CI).
 *   --config <path>  Explicit path to docmd.config (auto-detected if omitted).
 *
 * Exit codes:
 *   0  — every check passed (or warnings only, or --fix resolved everything).
 *   1  — at least one fatal problem / error remains.
 *   2  — usage error.
 * --------------------------------------------------------------------
 */

import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { TUI } from '@docmd/tui';
import { loadPlugins, runPluginDoctorChecks, type DoctorCheckResult } from '@docmd/api';
import { validateConfig } from '@docmd/parser';
import { loadConfig } from '../utils/config-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DiagnosticItem {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  hint?: string;
  fixable?: boolean;
}

export interface PluginReport {
  name: string;
  status: 'ok' | 'missing' | 'mismatch' | 'third-party' | 'unknown';
  declaredVersion?: string;
  installedVersion?: string;
  fixable: boolean;
  hint?: string;
}

export interface DoctorReport {
  timestamp: string;
  environment: {
    node: string;
    nodeStatus: 'ok' | 'warn' | 'error';
    packageManager: string;
    platform: string;
    arch: string;
  };
  project: {
    configPath: string | null;
    configStatus: 'ok' | 'warn' | 'error';
    srcDir: string;
    documentCount: number;
    diagnostics: DiagnosticItem[];
  };
  core: { name: string; version: string; status: 'ok' | 'missing' };
  plugins: PluginReport[];
  pluginDiagnostics: Record<string, DoctorCheckResult[]>;
  template?: { requested: string; resolved: string; status: 'ok' | 'missing' };
  engines: Array<{ name: string; status: 'ok' | 'missing' | 'unknown' }>;
  autoInstallCandidates: string[];
  summary: {
    passed: number;
    warnings: number;
    errors: number;
  };
}

export interface DoctorOptions {
  configPath?: string;
  fix: boolean;
  json: boolean;
}

/**
 * Auto-discover configuration file in cwd or ancestors.
 */
function findConfigFile(cwd: string): string | null {
  const candidates = [
    'docmd.config.jsonc',
    'docmd.config.json',
    'docmd.config.ts',
    'docmd.config.js',
    'docmd.config.mjs',
    'docmd.config.cjs',
    'config.js'
  ];
  for (const c of candidates) {
    const p = path.join(cwd, c);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Recursively count documentation source files (.md, .markdown, .mdx, .ejs).
 */
function countDocFiles(dir: string, depth = 0, maxDepth = 6): number {
  if (depth > maxDepth || !fs.existsSync(dir)) return 0;
  let count = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'site' || entry.name === 'dist') continue;
      if (entry.isFile() && /\.(md|markdown|mdx|ejs)$/i.test(entry.name)) {
        count++;
      } else if (entry.isDirectory()) {
        count += countDocFiles(path.join(dir, entry.name), depth + 1, maxDepth);
      }
    }
  } catch { /* ignore unreadable dirs */ }
  return count;
}

/**
 * Verify navigation links exist on disk.
 */
function verifyNavigationLinks(nav: any, srcDir: string, cwd: string): DiagnosticItem[] {
  const issues: DiagnosticItem[] = [];
  if (!nav) return issues;

  function walk(items: any[]) {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item) continue;
      const target = item.path ?? item.file ?? item.url;
      if (typeof target === 'string' && !target.startsWith('http://') && !target.startsWith('https://') && !target.startsWith('//') && !target.startsWith('external:') && !target.startsWith('#')) {
        // Strip query, hash, and leading/trailing slashes
        const clean = target.split('?')[0].split('#')[0].replace(/^\/+/g, '').replace(/\/+$/g, '');
        if (clean === '') {
          const rootCandidates = [
            path.resolve(srcDir, 'index.md'),
            path.resolve(srcDir, 'index.markdown'),
            path.resolve(cwd, 'index.md'),
            path.resolve(cwd, 'index.markdown'),
          ];
          if (!rootCandidates.some(c => fs.existsSync(c))) {
            issues.push({
              name: 'Navigation Target',
              status: 'warn',
              message: `Navigation item "${item.title || item.name || 'Home'}" targets root index page, but index.md was not found.`,
              hint: `Create index.md in ${path.relative(cwd, srcDir) || '.'}`
            });
          }
        } else {
          const candidates = [
            path.resolve(srcDir, clean),
            path.resolve(srcDir, `${clean}.md`),
            path.resolve(srcDir, `${clean}.markdown`),
            path.resolve(srcDir, `${clean}.mdx`),
            path.resolve(srcDir, clean, 'index.md'),
            path.resolve(cwd, clean),
            path.resolve(cwd, `${clean}.md`),
            path.resolve(cwd, clean, 'index.md'),
          ];
          const exists = candidates.some(c => fs.existsSync(c));
          if (!exists) {
            issues.push({
              name: 'Navigation Target',
              status: 'warn',
              message: `Navigation item "${item.title || item.name || clean}" targets non-existent file: "${target}"`,
              hint: `Create "${clean}.md" in ${path.relative(cwd, srcDir) || '.'} or update navigation entry.`
            });
          }
        }
      }
      if (item.items) walk(item.items);
      if (item.children) walk(item.children);
    }
  }

  if (Array.isArray(nav)) {
    walk(nav);
  } else if (typeof nav === 'object') {
    for (const val of Object.values(nav)) {
      if (Array.isArray(val)) walk(val);
    }
  }
  return issues;
}

export async function runDoctor(opts: DoctorOptions): Promise<number> {
  const origLog = console.log;
  const origWarn = console.warn;
  if (opts.json) {
    console.log = (..._args: any[]) => {};
    console.warn = (..._args: any[]) => {};
  }

  const cwd = process.cwd();
  const pkgManager = detectPackageManager(cwd);
  let configPath = opts.configPath ? path.resolve(cwd, opts.configPath) : findConfigFile(cwd);

  let config: any = {};
  let configStatus: 'ok' | 'warn' | 'error' = 'ok';
  const projectDiagnostics: DiagnosticItem[] = [];

  // 1. Config loading & validation
  if (configPath && fs.existsSync(configPath)) {
    try {
      const loaded = await loadConfig(configPath, { cwd, quiet: true });
      config = loaded?.config || loaded || {};
      
      const validation = validateConfig(config);
      if (!validation.isValid && validation.errors?.length > 0) {
        configStatus = 'warn';
        for (const err of validation.errors) {
          projectDiagnostics.push({
            name: 'Config Schema',
            status: 'warn',
            message: err
          });
        }
      }
    } catch (e: any) {
      configStatus = 'error';
      projectDiagnostics.push({
        name: 'Config Loader',
        status: 'error',
        message: `Failed to load config at ${path.relative(cwd, configPath)}: ${e.message}`
      });
    }
  } else {
    configStatus = 'warn';
    configPath = null;
    projectDiagnostics.push({
      name: 'Configuration',
      status: 'warn',
      message: 'No docmd.config file found. docmd will run in zero-config mode.',
      hint: 'Run `docmd init` to scaffold a configuration file.'
    });
  }

  // 2. Docs directory and files check
  const declaredSrc = config.src || 'docs';
  const absSrcDir = path.resolve(cwd, declaredSrc);
  const srcExists = fs.existsSync(absSrcDir);
  const docCount = countDocFiles(srcExists ? absSrcDir : cwd);

  if (!srcExists && declaredSrc !== 'docs') {
    projectDiagnostics.push({
      name: 'Source Directory',
      status: 'error',
      message: `Configured source directory "${declaredSrc}" does not exist.`
    });
  } else if (!srcExists && docCount === 0) {
    projectDiagnostics.push({
      name: 'Documentation Files',
      status: 'warn',
      message: 'No documentation files (.md, .markdown, .mdx) found in docs/ or project root.',
      hint: 'Add an index.md file to get started.'
    });
  } else {
    projectDiagnostics.push({
      name: 'Documentation Content',
      status: 'ok',
      message: `Found ${docCount} documentation ${docCount === 1 ? 'file' : 'files'} in ${srcExists ? declaredSrc : '.'}`
    });
  }

  // 3. Navigation link checks
  const navIssues = verifyNavigationLinks(config.navigation, absSrcDir, cwd);
  projectDiagnostics.push(...navIssues);

  // 4. Static assets check
  if (config.static) {
    const staticDirs = Array.isArray(config.static) ? config.static : [config.static];
    for (const s of staticDirs) {
      if (typeof s === 'string' && !fs.existsSync(path.resolve(cwd, s))) {
        projectDiagnostics.push({
          name: 'Static Directory',
          status: 'warn',
          message: `Configured static directory "${s}" does not exist.`,
          hint: `Create "${s}" or remove it from static config.`
        });
      }
    }
  }

  // 5. Environment checks
  const nodeVer = process.version;
  const majorNode = parseInt(nodeVer.slice(1).split('.')[0], 10);
  const nodeStatus: 'ok' | 'warn' | 'error' = majorNode < 18 ? 'error' : majorNode < 20 ? 'warn' : 'ok';

  // 6. Report assembly
  const report: DoctorReport = {
    timestamp: new Date().toISOString(),
    environment: {
      node: nodeVer,
      nodeStatus,
      packageManager: pkgManager,
      platform: process.platform,
      arch: process.arch,
    },
    project: {
      configPath: configPath ? path.relative(cwd, configPath) : null,
      configStatus,
      srcDir: declaredSrc,
      documentCount: docCount,
      diagnostics: projectDiagnostics,
    },
    core: resolveCorePackage(),
    plugins: [],
    pluginDiagnostics: {},
    engines: [],
    autoInstallCandidates: [],
    summary: { passed: 0, warnings: 0, errors: 0 }
  };

  if (report.core.status === 'missing') {
    report.summary.errors++;
  } else {
    report.summary.passed++;
  }

  // 7. Configured Plugins check
  const configuredPlugins: Record<string, any> = (config.plugins || {});
  for (const [key, userOpts] of Object.entries(configuredPlugins)) {
    if (userOpts === false) continue;
    const pkgName = key.startsWith('@docmd/') ? key : `@docmd/plugin-${key}`;
    const installed = tryReadPackage(pkgName);
    if (installed) {
      report.plugins.push({
        name: key,
        status: 'ok',
        installedVersion: installed.version,
        fixable: false,
      });
      report.summary.passed++;
    } else {
      report.plugins.push({
        name: key,
        status: 'missing',
        fixable: true,
        hint: `Run \`docmd add ${key}\` or add "${pkgName}" to your dependencies.`,
      });
      report.autoInstallCandidates.push(pkgName);
      report.summary.warnings++;
    }
  }

  // 8. Active Template check
  if (config.theme?.template) {
    const tplName = String(config.theme.template).trim();
    const tplPkg = tplName.startsWith('@docmd/') ? tplName : `@docmd/template-${tplName}`;
    const installed = tryReadPackage(tplPkg);
    report.template = {
      requested: tplName,
      resolved: tplPkg,
      status: installed ? 'ok' : 'missing',
    };
    if (installed) {
      report.summary.passed++;
    } else {
      report.autoInstallCandidates.push(tplPkg);
      report.summary.warnings++;
    }
  }

  // 9. Engines check
  const requestedEngine = (config.engine || 'js').toLowerCase();
  report.engines.push({ name: 'js', status: 'ok' });
  report.summary.passed++;

  if (requestedEngine === 'rust' || config.engines?.rust) {
    const rustInstalled = tryReadPackage('@docmd/engine-rust');
    report.engines.push({ name: 'rust', status: rustInstalled ? 'ok' : 'missing' });
    if (rustInstalled) report.summary.passed++;
    else report.summary.warnings++;
  }
  if (requestedEngine === 'python' || config.engines?.python) {
    const pythonInstalled = tryReadPackage('@docmd/engine-python');
    report.engines.push({ name: 'python', status: pythonInstalled ? 'ok' : 'missing' });
    if (pythonInstalled) report.summary.passed++;
    else report.summary.warnings++;
  }

  // 10. Plugin Diagnostic Hooks (`onDoctorCheck`)
  try {
    await loadPlugins(config, { resolvePaths: [cwd], skipAutoInstall: true });
    const pluginCheckResults = await runPluginDoctorChecks(config, cwd);
    report.pluginDiagnostics = pluginCheckResults;

    for (const items of Object.values(pluginCheckResults)) {
      for (const item of items) {
        if (item.status === 'ok') report.summary.passed++;
        else if (item.status === 'warn') report.summary.warnings++;
        else if (item.status === 'error') report.summary.errors++;
      }
    }
  } catch (err: any) {
    report.summary.warnings++;
  }

  // Count project diagnostics into summary
  for (const d of projectDiagnostics) {
    if (d.status === 'ok') report.summary.passed++;
    else if (d.status === 'warn') report.summary.warnings++;
    else if (d.status === 'error') report.summary.errors++;
  }

  // 11. Optional Auto-Fix
  if (opts.fix && report.autoInstallCandidates.length > 0) {
    const { spawnSync } = await import('node:child_process');
    TUI.step(`Auto-installing ${report.autoInstallCandidates.length} candidate(s) via ${pkgManager}`, 'WAIT');
    try {
      const res = spawnSync(pkgManager, ['add', ...report.autoInstallCandidates], {
        stdio: 'inherit',
        cwd,
        timeout: 180000,
        shell: process.platform === 'win32'
      });
      if (res.status === 0) {
        TUI.step(`Successfully installed candidates`, 'DONE');
        report.autoInstallCandidates = [];
      } else {
        TUI.step(`Auto-install completed with warnings (exit code ${res.status})`, 'WARN');
      }
    } catch (e: any) {
      TUI.step(`Auto-install failed: ${e.message}`, 'FAIL');
      report.summary.errors++;
    }
  }

  // 12. Emit Report
  if (opts.json) {
    console.log = origLog;
    console.warn = origWarn;
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }

  return report.summary.errors > 0 ? 1 : 0;
}

/**
 * Modern, soothing terminal report formatter.
 */
function printReport(r: DoctorReport): void {
  const sym = (status: 'ok' | 'warn' | 'error') => {
    switch (status) {
      case 'ok':    return TUI.green('✔');
      case 'warn':  return TUI.yellow('▲');
      case 'error': return TUI.red('✖');
    }
  };

  console.log('');
  TUI.section('Pre-Flight Diagnostics (docmd doctor)');

  // ── System & Environment ──────────────────────────────────
  TUI.divider('Environment');
  console.log(`  ${sym(r.environment.nodeStatus)} Node.js          ${r.environment.node} ${r.environment.nodeStatus === 'warn' ? TUI.dim('(v20+ recommended)') : ''}`);
  console.log(`  ${TUI.green('✔')} Package Manager  ${r.environment.packageManager}`);
  console.log(`  ${TUI.green('✔')} Platform         ${r.environment.platform} (${r.environment.arch})`);
  console.log('');

  // ── Project & Content ─────────────────────────────────────
  TUI.divider('Project & Content');
  console.log(`  ${sym(r.project.configStatus)} Configuration     ${r.project.configPath ? r.project.configPath : TUI.dim('none (zero-config)')}`);
  console.log(`  ${TUI.green('✔')} Source Directory  ${r.project.srcDir}/ (${r.project.documentCount} docs)`);

  for (const d of r.project.diagnostics) {
    if (d.name === 'Documentation Content' || (d.name === 'Configuration' && !r.project.configPath)) continue;
    console.log(`  ${sym(d.status)} ${d.name.padEnd(16)} ${d.message}`);
    if (d.hint) console.log(`                   ${TUI.dim('› ' + d.hint)}`);
  }
  console.log('');

  // ── Core & Plugins ────────────────────────────────────────
  TUI.divider('Core & Ecosystem');
  console.log(`  ${r.core.status === 'ok' ? TUI.green('✔') : TUI.red('✖')} ${r.core.name.padEnd(16)} ${r.core.version.padEnd(10)} ${r.core.status === 'ok' ? TUI.dim('(installed)') : TUI.red('(missing)')}`);

  if (r.plugins.length > 0) {
    for (const p of r.plugins) {
      const s = p.status === 'ok' ? 'ok' : 'warn';
      const ver = p.installedVersion ? ` (${p.installedVersion})` : '';
      console.log(`  ${sym(s)} plugin:${p.name.padEnd(9)} ${p.status === 'ok' ? TUI.dim('active' + ver) : TUI.yellow('not installed')}`);
      if (p.hint) console.log(`                   ${TUI.dim('› ' + p.hint)}`);
    }
  }

  if (r.template) {
    const s = r.template.status === 'ok' ? 'ok' : 'warn';
    console.log(`  ${sym(s)} template         ${r.template.resolved} ${r.template.status === 'ok' ? TUI.dim('(installed)') : TUI.yellow('not installed')}`);
  }

  for (const e of r.engines) {
    const s = e.status === 'ok' ? 'ok' : 'warn';
    console.log(`  ${sym(s)} engine:${e.name.padEnd(9)} ${e.status === 'ok' ? TUI.dim('available') : TUI.yellow('not installed')}`);
  }
  console.log('');

  // ── Plugin Health Checks ──────────────────────────────────
  const pluginCheckEntries = Object.entries(r.pluginDiagnostics);
  if (pluginCheckEntries.length > 0) {
    TUI.divider('Plugin Diagnostics');
    for (const [pluginName, checks] of pluginCheckEntries) {
      for (const c of checks) {
        console.log(`  ${sym(c.status)} [${pluginName}] ${c.name.padEnd(14)} ${c.message}`);
        if (c.hint) console.log(`                   ${TUI.dim('› ' + c.hint)}`);
      }
    }
    console.log('');
  }

  // ── Auto-install Candidates ───────────────────────────────
  if (r.autoInstallCandidates.length > 0) {
    TUI.divider('Recommendations');
    console.log(`  ${TUI.yellow('▲')} ${r.autoInstallCandidates.length} package(s) can be auto-installed:`);
    for (const c of r.autoInstallCandidates) {
      console.log(`    • ${c}`);
    }
    console.log(`    ${TUI.dim('Run `docmd doctor --fix` to install automatically.')}\n`);
  }

  // ── Summary ───────────────────────────────────────────────
  const { passed, warnings, errors } = r.summary;
  if (errors > 0) {
    TUI.error(`Diagnostics finished: ${errors} error(s), ${warnings} warning(s), ${passed} passed`);
  } else if (warnings > 0) {
    TUI.warn(`Diagnostics passed with ${warnings} warning(s) (${passed} checks passed)`);
  } else {
    TUI.success(`All checks passed cleanly (${passed} checks passed)`);
  }
  console.log('');
}

/**
 * Resolve @docmd/core package.
 */
function resolveCorePackage(): { name: string; version: string; status: 'ok' | 'missing' } {
  const FAIL = { name: '@docmd/core', version: 'unknown', status: 'missing' as const };
  const SEARCH_NAMES = new Set(['@docmd/core', 'docmd']);

  try {
    const req = createRequire(import.meta.url);
    const pkg = req('@docmd/core/package.json');
    return { name: pkg.name, version: pkg.version, status: 'ok' };
  } catch { /* fall through */ }

  for (let dir = path.resolve(process.cwd()); ; ) {
    const candidate = path.join(dir, 'node_modules', '@docmd', 'core', 'package.json');
    if (fs.existsSync(candidate)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (SEARCH_NAMES.has(pkg.name)) {
          return { name: pkg.name, version: pkg.version, status: 'ok' };
        }
      } catch { /* try next */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  let dir = path.resolve(__dirname);
  while (true) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (SEARCH_NAMES.has(pkg.name)) {
          return { name: pkg.name, version: pkg.version, status: 'ok' };
        }
      } catch { /* try next */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return FAIL;
}

/**
 * Read package.json for plugins/templates/engines.
 */
function tryReadPackage(name: string): { name: string; version: string } | null {
  try {
    const req = createRequire(import.meta.url);
    const pkg = req(`${name}/package.json`);
    return { name: pkg.name, version: pkg.version };
  } catch { /* fall through */ }

  for (let dir = path.resolve(process.cwd()); ; ) {
    const candidate = path.join(dir, 'node_modules', ...name.split('/'), 'package.json');
    if (fs.existsSync(candidate)) {
      try {
        return JSON.parse(fs.readFileSync(candidate, 'utf8'));
      } catch { /* try next */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  let dir = path.resolve(__dirname);
  while (true) {
    const candidate = path.join(dir, 'node_modules', ...name.split('/'), 'package.json');
    if (fs.existsSync(candidate)) {
      try {
        return JSON.parse(fs.readFileSync(candidate, 'utf8'));
      } catch { /* try next */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

function detectPackageManager(cwd: string): 'pnpm' | 'yarn' | 'bun' | 'npm' {
  let dir = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
    if (fs.existsSync(path.join(dir, 'bun.lockb'))) return 'bun';
    if (fs.existsSync(path.join(dir, 'package-lock.json'))) return 'npm';
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return 'npm';
}