/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * @package     @docmd/core (and ecosystem)
 * @website     https://docmd.io
 * @repository  https://github.com/docmd-io/docmd
 * @license     MIT
 * @copyright   Copyright (c) 2025-present docmd.io
 *
 * [docmd-source] - Please do not remove this header.
 * --------------------------------------------------------------------
 */

/**
 * Workspace Handler.
 *
 * Enables a single docmd instance to build multiple independent
 * documentation projects under one domain.
 *
 * Root config:
 *   workspace: {
 *     projects: [
 *       { prefix: '/',       src: 'docmd-main' },
 *       { prefix: '/search', src: 'docmd-search' }
 *     ]
 *   }
 *
 * Each project folder has its own docmd.config.json with its own
 * title, versions, i18n, plugins, navigation, etc.
 *
 * Output merges into a single site/ directory:
 *   site/                     ← root project
 *   site/search/              ← prefixed project
 *
 * Assets:
 *   - Root-level assets/ are shared across all projects
 *   - Each project can have its own assets/ that override shared ones
 */

import path from 'path';
import { fsUtils as fs, FileSignatureTracker } from '@docmd/utils';
import nativeFs from 'fs';
import { TUI } from '@docmd/tui';
import { loadConfig } from '../utils/config-loader.js';
import { buildSite } from '../commands/build.js';
import { createOriginVerify } from '../utils/ws-origin-guard.js';

/* ── Types ─────────────────────────────────────────────────── */

export interface ProjectEntry {
  /** URL prefix. '/' for root, '/search' for subpath. */
  prefix: string;
  /** Source directory relative to CWD (contains the project's docmd.config.js). */
  src: string;
  /** Optional: Display title for the project switcher. */
  title?: string;
}

export interface WorkspaceConfig {
  /** The list of projects in the workspace. */
  projects: ProjectEntry[];
  /** Project switcher configuration. */
  switcher?: {
    enabled?: boolean;
    position?: 'sidebar-top' | 'sidebar-bottom' | 'options-menu';
  };
}

export interface WorkspaceRootConfig {
  /** The workspace configuration. */
  workspace?: WorkspaceConfig;
  /** Legacy projects array (deprecated, maps to workspace.projects). */
  projects?: ProjectEntry[];
  /** Shared output directory. Default: 'site' */
  out?: string;
  /** Internal: Absolute path to the config file itself. Used for hot-reloading. */
  _resolvedPath?: string;
  /** Internal: Any other root keys act as global defaults. */
  [key: string]: any;
}

/* ── Detection ─────────────────────────────────────────────── */

/**
 * Check if a raw config object is a workspace config.
 */
export function isWorkspace(rawConfig: any): rawConfig is WorkspaceRootConfig {
  if (!rawConfig) return false;

  // New 'workspace' schema
  if (rawConfig.workspace && Array.isArray(rawConfig.workspace.projects)) {
    return rawConfig.workspace.projects.every((p: any) =>
      typeof p.prefix === 'string' && typeof p.src === 'string'
    );
  }

  // Legacy 'projects' schema (for backward compatibility)
  if (Array.isArray(rawConfig.projects) && rawConfig.projects.length > 0) {
    return rawConfig.projects.every((p: any) =>
      typeof p.prefix === 'string' && typeof p.src === 'string'
    );
  }

  return false;
}

/**
 * Load the raw config file without normalization to check for workspace settings.
 */
export async function detectWorkspace(configPathOption: string): Promise<WorkspaceRootConfig | null> {
  const CWD = process.cwd();
  let absolutePath = path.resolve(CWD, configPathOption);

  if (configPathOption === 'docmd.config.js') {
    const candidates = [
      'docmd.config.json',
      'docmd.config.ts',
      'docmd.config.js',
      'docmd.config.mjs',
      'config.js'
    ];
    let found = false;
    for (const c of candidates) {
      const p = path.resolve(CWD, c);
      if (nativeFs.existsSync(p)) {
        absolutePath = p;
        found = true;
        break;
      }
    }
    if (!found) return null;
  } else if (!nativeFs.existsSync(absolutePath)) {
    return null;
  }

  try {
    let rawConfig: any;

    if (absolutePath.endsWith('.json')) {
      rawConfig = JSON.parse(nativeFs.readFileSync(absolutePath, 'utf-8'));
    } else {
      // Polyfill defineConfig
      (global as any).defineConfig = (config: any) => config;

      const ts = Date.now();
      const ext = path.extname(absolutePath);
      const tempPath = absolutePath.replace(new RegExp(`\\${ext}$`), `-${ts}${ext}`);
      nativeFs.copyFileSync(absolutePath, tempPath);

      const { pathToFileURL } = await import('url');
      const configUrl = pathToFileURL(tempPath).href;
      const rawModule = await import(configUrl);
      rawConfig = rawModule.default || rawModule;

      nativeFs.unlinkSync(tempPath);
      delete (global as any).defineConfig;
    }

    if (isWorkspace(rawConfig)) {
      rawConfig._resolvedPath = absolutePath;

      // Internal normalization: map legacy 'projects' to 'workspace.projects'
      if (!rawConfig.workspace && rawConfig.projects) {
        rawConfig.workspace = {
          projects: rawConfig.projects,
          switcher: { enabled: true, position: 'sidebar-top' }
        };
      } else if (rawConfig.workspace) {
        // Ensure default switcher settings
        rawConfig.workspace.switcher = {
          enabled: true,
          position: 'sidebar-top',
          ...rawConfig.workspace.switcher
        };
      }

      // Return workspace config only if it has workspace settings
      // This prevents false positives when a config has a 'workspace' field but no projects
      if (rawConfig.workspace && rawConfig.workspace.projects) {
        return rawConfig as WorkspaceRootConfig;
      }

      return null;
    }
    return null;
  } catch {
    delete (global as any).defineConfig;
    return null;
  }
}

/* ── Validation ────────────────────────────────────────────── */

function validateProjects(projects: ProjectEntry[]): void {
  const prefixes = new Set<string>();
  let hasRoot = false;

  for (const project of projects) {
    // Normalize prefix
    const prefix = project.prefix === '/' ? '/' : project.prefix.replace(/\/$/, '');

    if (prefixes.has(prefix)) {
      throw new Error(`Duplicate project prefix: "${prefix}"`);
    }
    prefixes.add(prefix);

    if (prefix === '/') hasRoot = true;

    // Verify source directory exists
    const srcPath = path.resolve(process.cwd(), project.src);
    if (!nativeFs.existsSync(srcPath)) {
      throw new Error(`Project source directory not found: ${project.src}`);
    }
  }

  if (!hasRoot) {
    throw new Error(
      'Workspace configuration must include a root project with prefix "/".\n' +
      'Each workspace needs one project that owns the site root, with the others mounted under their own prefixes.\n' +
      'Example:\n' +
      '  {\n' +
      '    "workspace": {\n' +
      '      "projects": [\n' +
      '        { "name": "main", "src": "./docs",     "prefix": "/" },\n' +
      '        { "name": "api",  "src": "./api-docs", "prefix": "/api/" }\n' +
      '      ]\n' +
      '    }\n' +
      '  }\n' +
      'See https://docs.docmd.io/configuration/workspaces/ for the full layout guide.'
    );
  }

  // Check for potential conflicts
  const rootProject = projects.find(p => p.prefix === '/');
  if (rootProject) {
    const rootSrcPath = path.resolve(process.cwd(), rootProject.src);
    for (const project of projects) {
      if (project.prefix === '/') continue;
      const prefixName = project.prefix.replace(/^\//, '');
      const conflictPath = path.join(rootSrcPath, prefixName);
      if (nativeFs.existsSync(conflictPath)) {
        TUI.warn(`Potential conflict: Root project has "${prefixName}/" folder which may conflict with project prefix "${project.prefix}".`);
        TUI.warn(`Content at "${rootProject.src}/${prefixName}/" will be overwritten by project "${project.src}".`);
      }
    }
  }
}

/* ── Build ─────────────────────────────────────────────────── */

/**
 * Build all projects in a workspace.
 */
export async function buildWorkspace(
  workspaceConfig: WorkspaceRootConfig,
  opts: { isDev?: boolean; offline?: boolean; quiet?: boolean; verbose?: boolean } = {}
): Promise<void> {
  const CWD = process.cwd();
  const rootOutDir = path.resolve(CWD, workspaceConfig.out || 'site');
  const totalElapsed = TUI.timer();

  const workspace = workspaceConfig.workspace!;
  validateProjects(workspace.projects);

  // Extract global defaults
  const globalDefaults: Record<string, any> = {};
  const skipKeys = ['workspace', 'projects', 'out', '_resolvedPath'];
  for (const key of Object.keys(workspaceConfig)) {
    if (!skipKeys.includes(key) && !key.startsWith('_')) {
      globalDefaults[key] = workspaceConfig[key];
    }
  }

  // Sort: root project first, then alphabetical
  const sorted = [...workspace.projects].sort((a, b) => {
    if (a.prefix === '/') return -1;
    if (b.prefix === '/') return 1;
    return a.prefix.localeCompare(b.prefix);
  });

  if (!opts.quiet) {
    TUI.section(`Workspace Build (${sorted.length} projects)`);
  }

  // Ensure clean output directory
  await fs.ensureDir(rootOutDir);

  // Copy shared assets first
  const sharedAssetsDir = path.resolve(CWD, 'assets');
  if (nativeFs.existsSync(sharedAssetsDir)) {
    if (!opts.quiet) {
      TUI.item('Shared assets', path.relative(CWD, sharedAssetsDir), TUI.dim, TUI.cyan);
    }
  }

  if (!opts.quiet) {
    TUI.footer(TUI.cyan);
  }

  for (const project of sorted) {
    const prefix = project.prefix === '/' ? '/' : project.prefix.replace(/\/$/, '');
    const projectSrcDir = path.resolve(CWD, project.src);

    const candidates = ['docmd.config.json', 'docmd.config.ts', 'docmd.config.js', 'docmd.config.mjs', 'config.js'];
    let resolvedConfigName: string | null = null;
    for (const c of candidates) {
      if (nativeFs.existsSync(path.join(projectSrcDir, c))) {
        resolvedConfigName = c;
        break;
      }
    }
    const hasProjectConfig = resolvedConfigName !== null;
    const configFileToUse = resolvedConfigName || 'docmd.config.js';

    const projectOutDir = prefix === '/'
      ? rootOutDir
      : path.join(rootOutDir, prefix.replace(/^\//, ''));

    const label = prefix === '/' ? `/ (root)` : prefix;

    if (!opts.quiet) {
      TUI.section(`Building Project: ${label}`);

      const originalCwdCheck = process.cwd();
      process.chdir(projectSrcDir);
      try {
        const childConfig = await loadConfig(configFileToUse, { isDev: opts.isDev, quiet: true });
        const childDetails = TUI.extractProjectDetails(childConfig, projectOutDir, CWD);
        TUI.projectDetails({
          engine: childConfig.engine && childConfig.engine !== 'js' ? childConfig.engine : undefined,
          source: `${project.src}/`,
          output: `${path.relative(CWD, projectOutDir)}/`,
          versions: childDetails.versions,
          locales: childDetails.locales,
        });
      } catch {
        TUI.item('Source', `${project.src}/`, TUI.dim, TUI.cyan);
        TUI.item('Output', `${path.relative(CWD, projectOutDir)}/`, TUI.dim, TUI.cyan);
      } finally {
        process.chdir(originalCwdCheck);
      }

      if (!hasProjectConfig) {
        TUI.item('Config', 'zero-config (no docmd.config.json found)', TUI.dim, TUI.cyan);
      }
    }

    const originalCwd = process.cwd();
    process.chdir(projectSrcDir);

    try {
      process.env.DOCMD_PROJECT_OUT = projectOutDir;
      process.env.DOCMD_PROJECT_PREFIX = prefix;

      if (nativeFs.existsSync(sharedAssetsDir)) {
        await fs.ensureDir(path.join(projectOutDir, 'assets'));
        await fs.copy(sharedAssetsDir, path.join(projectOutDir, 'assets'));
      }

      await buildSite(configFileToUse, {
        isDev:   opts.isDev   || false,
        offline: opts.offline || false,
        // Pass through quiet so the first build (quiet:false) shows git/search
        // indexing progress. Live-reload rebuilds always arrive with quiet:true
        // from buildWorkspaceProject, so they stay silent.
        quiet:   opts.quiet   || false,
        // Forward --verbose so the per-project normaliser prints every
        // container issue (unclosed ::: card, stray :::, etc.). Without
        // this, `docmd build --verbose` on a workspace config silently
        // drops the flag and only the aggregate error count is shown.
        verbose: opts.verbose || false,
        _globalDefaults: globalDefaults,
        _workspace: workspace,
        _activePrefix: prefix
      });

      if (!opts.quiet) {
        TUI.footer(TUI.cyan);
      }

    } catch (err: any) {
      if (!opts.quiet) {
        TUI.step(`Project ${label} build failed`, 'FAIL', TUI.cyan);
        TUI.footer(TUI.cyan);
      }
      TUI.error(`Build failed for ${label}`, err.message);
      if (!opts.isDev) process.exit(1);
    } finally {
      process.chdir(originalCwd);
      delete process.env.DOCMD_PROJECT_OUT;
      delete process.env.DOCMD_PROJECT_PREFIX;
    }
  }

  if (!opts.quiet) {
    const totalSize = await getDirectorySize(rootOutDir);
    TUI.success(`Workspace build complete. ${sorted.length} projects → ${path.relative(CWD, rootOutDir)}/ (${formatBytes(totalSize)}) in ${totalElapsed()}.\n`);
  }
}

/* ── Single Project Build ────────────────── */

async function buildWorkspaceProject(
  project: ProjectEntry,
  workspaceConfig: WorkspaceRootConfig,
  opts: { isDev?: boolean; offline?: boolean; quiet?: boolean; verbose?: boolean; targetFiles?: string[] } = {}
): Promise<void> {
  const CWD = process.cwd();
  const rootOutDir = path.resolve(CWD, workspaceConfig.out || 'site');
  const workspace = workspaceConfig.workspace!;
  const prefix = project.prefix === '/' ? '/' : project.prefix.replace(/\/$/, '');
  const projectSrcDir = path.resolve(CWD, project.src);

  const candidates = ['docmd.config.json', 'docmd.config.ts', 'docmd.config.js', 'docmd.config.mjs', 'config.js'];
  let resolvedConfigName: string | null = null;
  for (const c of candidates) {
    if (nativeFs.existsSync(path.join(projectSrcDir, c))) {
      resolvedConfigName = c;
      break;
    }
  }
  const configFileToUse = resolvedConfigName || 'docmd.config.js';

  const projectOutDir = prefix === '/'
    ? rootOutDir
    : path.join(rootOutDir, prefix.replace(/^\//, ''));

  const label = prefix === '/' ? '/ (root)' : prefix;

  const originalCwd = process.cwd();
  process.chdir(projectSrcDir);

  try {
    process.env.DOCMD_PROJECT_OUT = projectOutDir;
    process.env.DOCMD_PROJECT_PREFIX = prefix;

    const sharedAssetsDir = path.resolve(CWD, 'assets');
    if (nativeFs.existsSync(sharedAssetsDir)) {
      await fs.ensureDir(path.join(projectOutDir, 'assets'));
      await fs.copy(sharedAssetsDir, path.join(projectOutDir, 'assets'));
    }

    const globalDefaults: Record<string, any> = {};
    const skipKeys = ['workspace', 'projects', 'out', '_resolvedPath'];
    for (const key of Object.keys(workspaceConfig)) {
      if (!skipKeys.includes(key) && !key.startsWith('_')) {
        globalDefaults[key] = workspaceConfig[key];
      }
    }

    await buildSite(configFileToUse, {
      isDev: opts.isDev || false,
      offline: opts.offline || false,
      quiet: true,
      // Forward --verbose to the per-project build so container
      // normaliser issues are listed per file in verbose mode.
      verbose: opts.verbose || false,
      targetFiles: opts.targetFiles,
      _globalDefaults: globalDefaults,
      _workspace: workspace,
      _activePrefix: prefix
    });

  } catch (err: any) {
    TUI.error(`Build failed for ${label}`, err.message);
    throw err;
  } finally {
    process.chdir(originalCwd);
    delete process.env.DOCMD_PROJECT_OUT;
    delete process.env.DOCMD_PROJECT_PREFIX;
  }
}

/* ── Dev Server Wrapper ────────────────────────────────────── */

/**
 * Start dev server for workspace mode.
 */
export async function devWorkspace(
  workspaceConfig: WorkspaceRootConfig,
  opts: { port?: string; preserve?: boolean } = {}
): Promise<void> {
  try {
    await buildWorkspace(workspaceConfig, { isDev: true });
  } catch (err: any) {
    TUI.error('Initial build failed', err.message);
  }

  const CWD = process.cwd();
  const rootOutDir = path.resolve(CWD, workspaceConfig.out || 'site');

  const { serveStatic, findAvailablePort, formatPathForDisplay, getNetworkIp, openBrowser } = await import('../utils/dev-utils.js');
  const http = await import('http');
  const { WebSocketServer, WebSocket } = await import('ws');

  const state = { outputDir: rootOutDir };
  const server = http.createServer((req: any, res: any) => serveStatic(req, res, state.outputDir));

  const PORT = parseInt(opts.port || process.env.PORT || '3000', 10);
  const port = await findAvailablePort(PORT);

  let wss: any;

  function broadcastReload() {
    if (wss) {
      wss.clients.forEach((client: any) => {
        if (client.readyState === WebSocket.OPEN) client.send('reload');
      });
    }
  }

  // Phase 1.D: default to loopback. Set DOCMD_HOST=0.0.0.0 to expose on LAN
  // (with the verifyClient callback below still guarding the Origin header).
  const BIND_HOST = process.env.DOCMD_HOST || '127.0.0.1';

  server.listen(port, BIND_HOST, () => {
    if (BIND_HOST !== '127.0.0.1' && BIND_HOST !== '::1' && BIND_HOST !== 'localhost') {
      TUI.warn(`Workspace dev server bound to ${BIND_HOST} (LAN). verifyClient guards Origin.`);
    }
    const networkIp = getNetworkIp();
    // Phase 1.D: CWE-1385 CSWSH fix (N-S1). Even when bound to LAN, the
    // verifyClient callback rejects any Origin that isn't loopback or the
    // LAN IP returned by getNetworkIp().
    wss = new WebSocketServer({
      server,
      verifyClient: createOriginVerify(networkIp ? [networkIp] : []),
    });
    wss.on('error', (e: any) => TUI.error('WebSocket Error', e.message));

    // Action dispatcher for workspace plugin actions/events
    (async () => {
      try {
        const { createActionDispatcher, loadPlugins, hooks } = await import('@docmd/api');
        await loadPlugins(workspaceConfig as any, { resolvePaths: [CWD] });
        const dispatcher = createActionDispatcher(hooks, {
          projectRoot: CWD,
          config: workspaceConfig as any,
          broadcast: (event: string, data: any) => {
            if (wss) {
              wss.clients.forEach((client: any) => {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify({ type: 'event', name: event, data }));
                }
              });
            }
          }
        });

        for (const fn of hooks.onDevServerReady) {
          await fn(server, wss);
        }

        wss.on('connection', (ws: any) => {
          ws.on('message', async (raw: any) => {
            let msg: any;
            try { msg = JSON.parse(raw.toString()); } catch { return; }

            if (msg.type === 'call') {
              try {
                const { result } = await dispatcher.handleCall(msg.action, msg.payload);
                ws.send(JSON.stringify({ id: msg.id, type: 'response', result, reload: false }));
              } catch (e: any) {
                ws.send(JSON.stringify({ id: msg.id, type: 'response', error: e.message }));
              }
            } else if (msg.type === 'event') {
              dispatcher.handleEvent(msg.name, msg.data);
            }
          });
        });
      } catch (err: any) {
        TUI.warn(`Workspace plugin dispatcher setup: ${err.message}`);
      }
    })();

    const localUrl = `http://127.0.0.1:${port}`;
    const networkUrl = networkIp ? `http://${networkIp}:${port}` : null;

    TUI.section('Workspace Dev Server Running', TUI.green);
    TUI.item('', '', TUI.dim, TUI.green);
    TUI.item('Local Access', localUrl, TUI.bold, TUI.green);
    if (networkUrl) {
      TUI.item('Network Access', networkUrl, TUI.bold, TUI.green);
    }
    TUI.item('Serving from', formatPathForDisplay(rootOutDir, CWD), TUI.dim, TUI.green);
    TUI.item('', '', TUI.dim, TUI.green);

    const workspace = workspaceConfig.workspace!;
    for (const project of workspace.projects) {
      const pfx = project.prefix === '/' ? '/' : project.prefix;
      TUI.item('Project', localUrl + pfx, TUI.dim, TUI.green);
    }
    TUI.item('', '', TUI.dim, TUI.green);
    TUI.footer(TUI.green);

    // Auto-launch localhost URL in default browser
    openBrowser(localUrl);
  });

  let isRebuilding = false;
  let rebuildTimeout: any = null;
  let lastContentRebuildAt = 0;
  let lastConfigRebuildAt = 0;
  // Quiet windows after a rebuild to absorb phantom fs.watch events macOS
  // emits for newly-written nearby files. The primary defence is the
  // content-signature check (FileSignatureTracker) below; these are
  // secondary cushions.
  //   - 1000ms after a content rebuild
  //   - 2500ms after a full workspace config rebuild (cascades everywhere)
  const CONTENT_QUIET_MS = 1000;
  const CONFIG_QUIET_MS = 2500;
  // Tracks each watched file's mtime+size signature so phantom fs.watch
  // events that don't actually mutate the file are silently ignored.
  const signatureTracker = new FileSignatureTracker();

  const workspace = workspaceConfig.workspace!;
  for (const project of workspace.projects) {
    const projectSrcDir = path.resolve(CWD, project.src);

    if (!nativeFs.existsSync(projectSrcDir)) continue;

    nativeFs.watch(projectSrcDir, { recursive: true }, (event, filename) => {
      if (!filename) return;

      // Post-rebuild quiet period
      if (Date.now() - lastContentRebuildAt < CONTENT_QUIET_MS) return;
      if (Date.now() - lastConfigRebuildAt < CONFIG_QUIET_MS) return;

      if (filename.includes('.git') || filename.includes('node_modules') ||
          filename.includes('.DS_Store') || filename.startsWith('.') ||
          filename.includes('docmd.config-') || filename.endsWith('.js.bak')) return;

      // Exclude build output
      const resolvedOut = path.resolve(CWD, workspaceConfig.out || 'site');
      const filePath = path.resolve(projectSrcDir, filename);
      if (filePath.startsWith(resolvedOut + path.sep) || filePath === resolvedOut) return;

      // Content-signature gate: ignore phantom events that don't actually
      // mutate the file (Spotlight reindex, iCloud sync, etc.).
      if (!signatureTracker.hasChanged(filePath)) return;

      if (rebuildTimeout) clearTimeout(rebuildTimeout);
      rebuildTimeout = setTimeout(async () => {
        if (isRebuilding) return;
        isRebuilding = true;

        const isConfigUpdate = (filename.includes('docmd.config') && !filename.includes('docmd.config-')) || filename.includes('navigation.json');
        const label = project.prefix === '/' ? '/' : project.prefix;
        const displayPath = filename.replace(/^[^/]+\//, '');
        const rebuildElapsed = TUI.timer();

        if (isConfigUpdate) {
          TUI.step(`Reloading config and rebuilding [${label}]`, 'WAIT', TUI.blue, true);
        } else {
          TUI.step(`Rebuilding [${label}] ${displayPath}`, 'WAIT', TUI.blue, true);
        }

        try {
          const fullChangedPath = path.resolve(projectSrcDir, filename);
          await buildWorkspaceProject(project, workspaceConfig, {
            isDev: true,
            targetFiles: isConfigUpdate ? undefined : [fullChangedPath]
          });
          if (isConfigUpdate) {
            lastConfigRebuildAt = Date.now();
            signatureTracker.reset();
          } else {
            lastContentRebuildAt = Date.now();
          }
          const { wasWrittenByRpc } = await import('@docmd/api');
          if (!wasWrittenByRpc(fullChangedPath)) {
            broadcastReload();
          }
          TUI.step(`Rebuilt [${label}] ${isConfigUpdate ? 'with new config' : displayPath} in ${rebuildElapsed()}`, 'DONE', TUI.blue, true);
        } catch (err: any) {
          TUI.step(`Rebuild [${label}] ${displayPath}`, 'FAIL', TUI.blue, true);
          TUI.error('Rebuild failed', err.message);
        } finally {
          isRebuilding = false;
        }
      }, 600); // 600ms idle: rebuild only after user stops saving
    });
  }

  if (workspaceConfig._resolvedPath && nativeFs.existsSync(workspaceConfig._resolvedPath)) {
    let rootConfigDebounce: any = null;
    // Watch the parent directory rather than the file directly — far more
    // stable on macOS, where direct-file fs.watch fires phantom events from
    // Spotlight / iCloud / Time Machine.
    const rootConfigPath = workspaceConfig._resolvedPath;
    const rootConfigDir = path.dirname(rootConfigPath);
    const rootConfigBaseName = path.basename(rootConfigPath);

    nativeFs.watch(rootConfigDir, (event, filename) => {
      if (!filename) return;
      if (filename !== rootConfigBaseName) return;

      // Post-rebuild quiet period
      if (Date.now() - lastConfigRebuildAt < CONFIG_QUIET_MS) return;

      // Content-signature gate: ignore phantom events that don't actually
      // mutate the file.
      if (!signatureTracker.hasChanged(rootConfigPath)) return;

      if (rootConfigDebounce) clearTimeout(rootConfigDebounce);
      rootConfigDebounce = setTimeout(async () => {
        rootConfigDebounce = null;
        if (isRebuilding) return;
        isRebuilding = true;

        const rebuildElapsed = TUI.timer();
        TUI.step('Reloading workspace config...', 'WAIT', TUI.blue, true);

        try {
          const { detectWorkspace } = await import('./workspace.js');
          const newWorkspaceConfig = await detectWorkspace(rootConfigBaseName);
          if (newWorkspaceConfig) {
            Object.assign(workspaceConfig, newWorkspaceConfig);
            await buildWorkspace(newWorkspaceConfig, { isDev: true, quiet: true });
            lastConfigRebuildAt = Date.now();
            signatureTracker.reset();
            broadcastReload();
            TUI.step(`Rebuilt entire workspace with new config in ${rebuildElapsed()}`, 'DONE', TUI.blue, true);
          }
        } catch (err: any) {
          TUI.step('Workspace Rebuild', 'FAIL', TUI.blue, true);
          TUI.error('Rebuild failed', err.message);
        } finally {
          isRebuilding = false;
        }
      }, 500);
    });
  }

  if (nativeFs.existsSync(path.resolve(CWD, 'assets'))) {
    const sharedAssetsDir = path.resolve(CWD, 'assets');
    nativeFs.watch(sharedAssetsDir, { recursive: true }, (event, filename) => {
      if (!filename) return;
      // Post-rebuild quiet period
      if (Date.now() - lastContentRebuildAt < CONTENT_QUIET_MS) return;
      if (Date.now() - lastConfigRebuildAt < CONFIG_QUIET_MS) return;

      // Content-signature gate: ignore phantom events that don't actually
      // mutate the file.
      const filePath = path.resolve(sharedAssetsDir, filename);
      if (!signatureTracker.hasChanged(filePath)) return;

      if (rebuildTimeout) clearTimeout(rebuildTimeout);
      rebuildTimeout = setTimeout(async () => {
        if (isRebuilding) return;
        isRebuilding = true;

        const rebuildElapsed = TUI.timer();
        TUI.step('Shared assets changed — rebuilding all', 'WAIT', TUI.blue, true);

        try {
          await buildWorkspace(workspaceConfig, { isDev: true, quiet: true });
          lastContentRebuildAt = Date.now();
          broadcastReload();
          TUI.step(`All projects rebuilt in ${rebuildElapsed()}`, 'DONE', TUI.blue, true);
        } catch (err: any) {
          TUI.step('Rebuild all projects', 'FAIL', TUI.blue, true);
          TUI.error('Rebuild failed', err.message);
        } finally {
          isRebuilding = false;
        }
      }, 600); // 600ms idle: rebuild only after user stops saving
    });
  }

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (data) => {
      if (data[0] === 0x03) {
        process.emit('SIGINT' as any);
      }
    });
  }

  let isShuttingDown = false;
  process.on('SIGINT', () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    TUI.success('Shutting down workspace dev server...\n');
    server.close();
    if (wss) wss.close();
    process.exit(0);
  });
}

/* ── Helpers ───────────────────────────────────────────────── */

async function getDirectorySize(dir: string): Promise<number> {
  let total = 0;
  try {
    const entries = await nativeFs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        total += await getDirectorySize(fullPath);
      } else {
        const stat = await nativeFs.promises.stat(fullPath);
        total += stat.size;
      }
    }
  } catch { /* ignore */ }
  return total;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}