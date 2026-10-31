/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * @package     @docmd/parser
 * @website     https://docmd.io
 * @repository  https://github.com/docmd-io/docmd
 * @license     MIT
 * @copyright   Copyright (c) 2025-present docmd.io
 *
 * [docmd-source] - Please do not remove this header.
 * --------------------------------------------------------------------
 */

export interface VariableContext {
  pageTitle?: string;
  pageSlug?: string;
  pagePath?: string;
  frontmatter?: Record<string, any>;
  siteTitle?: string;
  siteBase?: string;
  cwd?: string;
}

export interface VariableRegistryOptions {
  configVariables?: Record<string, any> | string;
  cwd?: string;
  siteTitle?: string;
  siteBase?: string;
  version?: string;
  gitCommit?: string;
  gitBranch?: string;
}

/**
 * Cache git metadata once per build process so we don't spawn child processes repeatedly.
 */
let _cachedGitCommit: string | null = null;
let _cachedGitBranch: string | null = null;
let _gitAttempted = false;

function getGitMetadata(cwd: string, optionsCommit?: string, optionsBranch?: string): { commit: string; branch: string } {
  if (optionsCommit !== undefined || optionsBranch !== undefined) {
    return { commit: optionsCommit || '', branch: optionsBranch || '' };
  }
  if (_gitAttempted && _cachedGitCommit) {
    return { commit: _cachedGitCommit, branch: _cachedGitBranch || '' };
  }
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      let cp: any = null;
      try {
        const { createRequire } = Function('return import("node:module")')();
        // createRequire is async when imported dynamically
      } catch { /* ignore */ }
      if (typeof require !== 'undefined') {
        cp = require('child_process');
      }
      if (cp && cp.execSync) {
        _cachedGitCommit = cp.execSync('git rev-parse --short HEAD', { cwd, stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
        _cachedGitBranch = cp.execSync('git rev-parse --abbrev-ref HEAD', { cwd, stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
      }
    } catch {
      _cachedGitCommit = '';
      _cachedGitBranch = '';
    }
  }
  _gitAttempted = true;
  return { commit: _cachedGitCommit || '', branch: _cachedGitBranch || '' };
}

/**
 * Resolve a dot-notated or direct path in an object.
 * e.g., getNestedValue({ docmd: { buildYear: 2026 } }, 'docmd.buildYear') => 2026
 */
export function getNestedValue(obj: Record<string, any>, keyPath: string): any {
  if (!obj || typeof obj !== 'object') return undefined;
  if (keyPath in obj) return obj[keyPath];

  const parts = keyPath.split('.');
  let current: any = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

export class VariableRegistry {
  private baseVariables: Record<string, any> = {};
  private configVariables: Record<string, any> = {};
  private dynamicVariablesList: Set<string> = new Set();
  private cwd: string;
  private version: string;

  constructor(options: VariableRegistryOptions = {}) {
    this.cwd = options.cwd || process.cwd();
    this.version = options.version || '0.9.9';
    this.initBaseVariables(options);
    this.loadConfigVariables(options.configVariables);
  }

  private initBaseVariables(options: VariableRegistryOptions): void {
    const now = new Date();
    const isoString = now.toISOString();
    const buildDate = isoString.split('T')[0];
    const buildYear = String(now.getFullYear());
    const git = getGitMetadata(this.cwd, options.gitCommit, options.gitBranch);

    // 1. Built-in system variables
    const docmdBuiltins: Record<string, any> = {
      version: this.version,
      buildTime: isoString,
      buildDate,
      buildYear,
      gitCommit: git.commit,
      gitBranch: git.branch
    };

    this.baseVariables['docmd'] = docmdBuiltins;
    this.baseVariables['DOCMD_VERSION'] = this.version;
    this.baseVariables['BUILD_TIME'] = isoString;
    this.baseVariables['BUILD_DATE'] = buildDate;
    this.baseVariables['BUILD_YEAR'] = buildYear;
    this.baseVariables['GIT_COMMIT'] = git.commit;
    this.baseVariables['GIT_BRANCH'] = git.branch;
    this.baseVariables['git'] = {
      commit: git.commit,
      branch: git.branch
    };

    if (options.siteTitle) {
      this.baseVariables['site'] = {
        title: options.siteTitle,
        base: options.siteBase || '/'
      };
      this.baseVariables['SITE_TITLE'] = options.siteTitle;
      this.baseVariables['siteTitle'] = options.siteTitle;
    }

    // 2. Environment variables from system (process.env)
    const envVars: Record<string, string> = {};
    if (typeof process !== 'undefined' && process.env) {
      for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined) {
          envVars[k] = v;
          // Auto-promote DOCMD_VAR_* to top-level key
          if (k.startsWith('DOCMD_VAR_')) {
            const cleanKey = k.substring('DOCMD_VAR_'.length);
            this.baseVariables[cleanKey] = v;
            this.baseVariables[k] = v;
          }
        }
      }
    }
    this.baseVariables['env'] = envVars;
  }

  private loadConfigVariables(configVars?: Record<string, any> | string): void {
    if (!configVars) return;

    if (typeof configVars === 'string') {
      if (typeof process !== 'undefined' && process.versions?.node) {
        try {
          const req = Function('return require')();
          const pathMod = req('path');
          const fsMod = req('fs');
          const filePath = pathMod.isAbsolute(configVars) ? configVars : pathMod.resolve(this.cwd, configVars);
          if (fsMod.existsSync(filePath)) {
            if (filePath.endsWith('.json')) {
              const content = fsMod.readFileSync(filePath, 'utf8');
              this.configVariables = JSON.parse(content);
            }
          }
        } catch (err) {
          console.warn(`[docmd-variables] Failed to load variables file "${configVars}":`, err);
        }
      }
    } else if (typeof configVars === 'object' && configVars !== null) {
      this.configVariables = { ...configVars };
    }
  }

  /**
   * Set or merge additional runtime/build variables.
   */
  public set(key: string | Record<string, any>, value?: any): void {
    if (typeof key === 'string') {
      this.configVariables[key] = value;
    } else if (typeof key === 'object' && key !== null) {
      Object.assign(this.configVariables, key);
    }
  }

  /**
   * Mark variable keys as dynamic (so they render with <span data-docmd-var="..."> for client-side hydration).
   */
  public markDynamic(keys: string | string[]): void {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const k of list) {
      this.dynamicVariablesList.add(k);
    }
  }

  public isDynamic(key: string): boolean {
    if (this.dynamicVariablesList.has(key)) return true;
    // By convention, variables starting with user.* or session.* or client.* are treated as dynamic
    if (key.startsWith('user.') || key.startsWith('session.') || key.startsWith('client.')) {
      return true;
    }
    return false;
  }

  /**
   * Resolve a variable value against:
   * 1. Per-page context (frontmatter, page title, slug)
   * 2. Config variables (docmd.config.json or loaded files)
   * 3. Base variables (docmd builtins, environment vars)
   */
  public get(keyPath: string, context?: VariableContext): any {
    const cleanKey = keyPath.trim();

    // 1. Page context variables
    if (context) {
      if (cleanKey === 'page.title' || cleanKey === 'PAGE_TITLE') return context.pageTitle;
      if (cleanKey === 'page.slug' || cleanKey === 'PAGE_SLUG') return context.pageSlug;
      if (cleanKey === 'page.path' || cleanKey === 'PAGE_PATH') return context.pagePath;
      if (cleanKey.startsWith('frontmatter.') && context.frontmatter) {
        return getNestedValue(context.frontmatter, cleanKey.substring('frontmatter.'.length));
      }
      if (context.frontmatter && cleanKey in context.frontmatter) {
        return context.frontmatter[cleanKey];
      }
    }

    // 2. Config-defined variables
    const valFromConfig = getNestedValue(this.configVariables, cleanKey);
    if (valFromConfig !== undefined) return valFromConfig;

    // 3. Base / Built-in / Environment variables
    const valFromBase = getNestedValue(this.baseVariables, cleanKey);
    if (valFromBase !== undefined) return valFromBase;

    return undefined;
  }

  /**
   * Get complete dictionary of all current variables.
   */
  public getAll(context?: VariableContext): Record<string, any> {
    return {
      ...this.baseVariables,
      ...this.configVariables,
      ...(context?.frontmatter || {}),
      ...(context ? { page: { title: context.pageTitle, slug: context.pageSlug, path: context.pagePath } } : {})
    };
  }
}
