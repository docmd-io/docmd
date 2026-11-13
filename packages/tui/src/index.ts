/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * @package     @docmd/tui
 * @website     https://docmd.io
 * @repository  https://github.com/docmd-io/docmd
 * @license     MIT
 * @copyright   Copyright (c) 2025-present docmd.io
 *
 * [docmd-source] - Please do not remove this header.
 * --------------------------------------------------------------------
 */

import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const pkgUrl = new URL('../package.json', import.meta.url);
const { version: PKG_VERSION } = JSON.parse(readFileSync(pkgUrl, 'utf-8'));

const LOGO = `
    _                 _ 
  _| |___ ___ _____ _| |
 | . | . |  _|     | . |
 |___|___|___|_|_|_|___|
`;

/* ── Progress bar ───────────────────────────────────────────── */

const BAR_WIDTH = 20;
const BAR_FULL  = '━';
const BAR_EMPTY = '─';

function renderBar(current: number, total: number): string {
  const ratio  = total > 0 ? Math.min(current / total, 1) : 0;
  const filled = Math.round(ratio * BAR_WIDTH);
  const pct    = Math.round(ratio * 100);
  return `${BAR_FULL.repeat(filled)}${BAR_EMPTY.repeat(BAR_WIDTH - filled)}  (${pct}%)`;
}

/* ── Spinner ────────────────────────────────────────────────── */

const SPINNER_FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

/* ── TTY helpers ────────────────────────────────────────────── */

function isTTY(): boolean { return process.stdout.isTTY === true; }

function eraseLines(n: number): void {
  for (let i = 0; i < n; i++) process.stdout.write('\x1b[1A\x1b[2K');
}

/* ── Duration ───────────────────────────────────────────────── */

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/* ──────────────────────────────────────────────────────────────
 * Active-line state machine
 *
 * Layout while a WAIT step is active:
 *
 *   │  [ WAIT ] Label text here           ← wait line
 *   │           ━━━━━━━━━━━━━━━━  (42%)  ← progress bar  ← _progressLines ≥ 1
 *   │                                    ← breathing room ← _progressLines = 2
 *
 * _waitLine      : text of the current WAIT step (null = none active)
 * _waitBarColor  : chalk colour function used for that step's bar glyph
 * _progressLines : how many lines BELOW the wait line are "active"
 *                  0 = nothing extra  1 = blank only  2 = bar + blank
 * ────────────────────────────────────────────────────────────── */

let _waitLine:     string | null = null;
let _progressLines = 0;

// Section auto-close tracking
let _sectionOpen  = false;
let _sectionColor = chalk.cyan;

/** Erase only the progress area below the wait line. */
function clearProgressArea(): void {
  if (_progressLines > 0 && isTTY()) {
    eraseLines(_progressLines);
    _progressLines = 0;
  }
}

/** Erase the full active block: progress area + the wait line itself. */
function clearActiveBlock(): void {
  if (!isTTY()) return;
  const total = _progressLines + (_waitLine !== null ? 1 : 0);
  if (total > 0) eraseLines(total);
  _progressLines = 0;
  _waitLine      = null;
}

/** Commit any active state before printing structural output (section/footer). */
function commitState(): void {
  clearProgressArea();
  // Leave the wait line on-screen — it will be resolved by its own DONE/FAIL call
  _progressLines = 0;
}

/* ── Flag helpers ───────────────────────────────────────────── */

function flag(status: string): string {
  switch (status) {
    case 'DONE': return chalk.green('[ DONE ]');
    case 'FAIL': return chalk.red  ('[ FAIL ]');
    case 'SKIP': return chalk.yellow('[ SKIP ]');
    case 'WAIT': return chalk.cyan ('[ WAIT ]');
    case 'INFO': return chalk.blue ('[ INFO ]');
    case 'WARN': return chalk.yellow('[ WARN ]');
    default:     return chalk.blue (`[ ${status.padEnd(4)} ]`);
  }
}

export interface ScopedLogger {
  step: (label: string, status?: 'DONE'|'WAIT'|'SKIP'|'FAIL'|string) => void;
  info: (msg: string) => void;
  success: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string, detail?: string) => void;
  progress: (label: string, current: number, total: number) => void;
}

export function createLogger(scope: string): ScopedLogger {
  const prefix = chalk.dim(`[${scope}]`).padEnd(10);
  return {
    step: (label: string, status: 'DONE'|'WAIT'|'SKIP'|'FAIL'|string = 'WAIT') => {
      TUI.step(`${prefix} ${label}`, status);
    },
    info: (msg: string) => {
      commitState();
      console.log(`${flag('INFO')} ${prefix} ${msg}`);
    },
    success: (msg: string) => {
      commitState();
      console.log(`${flag('DONE')} ${prefix} ${chalk.bold(msg)}`);
    },
    warn: (msg: string) => {
      commitState();
      console.log(`${flag('WARN')} ${prefix} ${msg}`);
    },
    error: (msg: string, detail?: string) => {
      commitState();
      console.error(`${flag('FAIL')} ${prefix} ${chalk.red(msg)}`);
      if (detail) {
        detail.split('\n').forEach(l => console.error(`         ${prefix} ${chalk.dim(l)}`));
      }
    },
    progress: (label: string, current: number, total: number) => {
      TUI.progress(`${prefix} ${label}`, current, total);
    }
  };
}

/**
 * Modern Minimalist Terminal UI (TUI)
 * Standalone package with zero internal dependencies.
 * Clean, borderless, pipe-free layout using fixed-width text flags.
 */
export const TUI = {
  // Semantic colors
  blue:   chalk.blue,
  cyan:   chalk.cyan,
  green:  chalk.green,
  yellow: chalk.yellow,
  red:    chalk.red,
  dim:    chalk.dim,
  bold:   chalk.bold,

  banner: (logo: string = LOGO, version: string = PKG_VERSION) => {
    commitState();
    if (process.env.NO_COLOR || process.env.DOCMD_NO_BANNER) return;
    console.log(`\n${chalk.blue(logo)}`);
    console.log(`${chalk.dim(`  v${version}`)}\n`);
  },

  section: (label: string, color = chalk.cyan) => {
    commitState();
    _sectionColor = color;
    _sectionOpen  = true;
    let formattedLabel = label;
    if (label.includes(':')) {
      const idx = label.indexOf(':');
      const prefix = label.slice(0, idx).toUpperCase();
      const rest = label.slice(idx);
      formattedLabel = prefix + rest;
    } else {
      formattedLabel = label.toUpperCase();
    }
    console.log(`\n${color.bold(formattedLabel)}\n`);
  },

  divider: (label: string, color = chalk.blue) => {
    commitState();
    console.log(`${color.bold(label.toUpperCase())}`);
  },

  /**
   * Print a status step line with fixed-width text flag.
   */
  step: (label: string, status: 'DONE'|'WAIT'|'SKIP'|'FAIL'|string = 'WAIT', _barColor = chalk.cyan, _statusFirst?: boolean) => {
    const f    = flag(status);
    const line = `${f} ${chalk.dim(label)}`;

    if (status === 'WAIT') {
      if (isTTY() && _waitLine !== null) {
        eraseLines(_progressLines + 1);
      } else {
        clearProgressArea();
      }
      console.log(line);
      _waitLine      = label;
      _progressLines = 0;

    } else {
      if (isTTY() && _waitLine !== null) {
        eraseLines(_progressLines + 1);
      }
      console.log(line);
      _waitLine      = null;
      _progressLines = 0;
    }
  },

  item: (label: string, value: string, labelColor = chalk.dim, _barColor = chalk.cyan) => {
    commitState();
    const formattedLabel = label ? label.padEnd(15) : ''.padEnd(15);
    console.log(`${labelColor(formattedLabel)} ${value}`);
  },

  /**
   * Render plugin status entries inside an open section.
   */
  pluginTree: (
    pluginName: string,
    entries: Array<{ msg: string; status: 'DONE'|'SKIP'|'FAIL'|'WAIT' }>,
    _color = chalk.cyan,
  ) => {
    commitState();
    if (!entries || entries.length === 0) return;

    const key = chalk.bold(`[${pluginName}]`).padEnd(8);

    const parentIdx = (() => {
      const idx = entries.findIndex(e => e.status === 'DONE' || e.status === 'FAIL');
      return idx === -1 ? 0 : idx;
    })();

    const parent = entries[parentIdx];
    console.log(`${flag(parent.status)} ${key} ${chalk.dim(parent.msg)}`);

    if (entries.length === 1) return;

    for (let i = 0; i < entries.length; i++) {
      if (i === parentIdx) continue;
      const e = entries[i];
      console.log(`${flag(e.status)} ${key} ${chalk.dim(e.msg)}`);
    }
  },

  createLogger,
  scoped: createLogger,

  footer: (_color = chalk.cyan) => {
    commitState();
    _sectionOpen = false;
  },

  info: (msg: string) => {
    commitState();
    console.log(`${flag('INFO')} ${msg}`);
  },

  success: (msg: string) => {
    commitState();
    console.log(`${flag('DONE')} ${chalk.bold(msg)}`);
  },

  warn: (msg: string) => {
    commitState();
    console.log(`${flag('WARN')} ${msg}`);
  },

  error: (msg: string, detail?: string) => {
    commitState();
    console.error(`${flag('FAIL')} ${chalk.red(msg)}`);
    if (detail) {
      detail.split('\n').forEach(l => console.error(`         ${chalk.dim(l)}`));
    }
  },

  // ── Progress Bar ───────────────────────────────────────────

  progress: (label: string, current: number, total: number, _barColor = chalk.cyan) => {
    const bar  = renderBar(current, total);
    const line = `${flag('WAIT')} ${chalk.cyan(bar)} ${chalk.dim(label)}`;

    if (!isTTY()) {
      const pct = total > 0 ? Math.round((current / total) * 100) : 0;
      if (current >= total || pct === 25 || pct === 50 || pct === 75) {
        console.log(line);
      }
      return;
    }

    if (_progressLines > 0) eraseLines(_progressLines);
    process.stdout.write(`${line}\n`);
    _progressLines = 1;
  },

  // ── Spinner ────────────────────────────────────────────────

  spinner: (label: string, _barColor = chalk.cyan) => {
    let frameIndex   = 0;
    let currentLabel = label;
    let stopped      = false;

    const waitLine = `${chalk.blue('[ WAIT ]')} ${chalk.dim(currentLabel)}`;
    console.log(waitLine);
    _waitLine      = currentLabel;
    _progressLines = 0;

    const render = () => {
      if (stopped || !isTTY()) return;
      const frame = chalk.cyan(SPINNER_FRAMES[frameIndex++ % SPINNER_FRAMES.length]);
      process.stdout.write('\x1b[1A\r\x1b[2K');
      process.stdout.write(`${chalk.blue(`[ ${frame} ]`)} ${chalk.dim(currentLabel)}\n`);
    };

    const interval = isTTY() ? setInterval(render, 80) : null;
    if (interval) interval.unref();

    const finish = (status: 'DONE' | 'FAIL', finalLabel?: string) => {
      stopped = true;
      if (interval) clearInterval(interval);
      const fl = finalLabel || currentLabel;
      if (isTTY()) eraseLines(1);
      const f  = status === 'DONE' ? chalk.green('[ DONE ]') : chalk.red('[ FAIL ]');
      console.log(`${f} ${chalk.dim(fl)}`);
      _waitLine      = null;
      _progressLines = 0;
    };

    return {
      update: (newLabel: string) => { currentLabel = newLabel; },
      done:   (doneLabel?: string, _statusFirst?: boolean) => finish('DONE', doneLabel),
      fail:   (failLabel?: string, _statusFirst?: boolean) => finish('FAIL', failLabel),
    };
  },

  // ── Counter ────────────────────────────────────────────────

  counter: (label: string, count: number, _barColor = chalk.cyan) => {
    const line = `${chalk.dim(label)} ${chalk.bold(String(count))}`;
    if (isTTY()) process.stdout.write(`\r\x1b[K${line}`);
  },

  commitLine: (label: string, _barColor = chalk.cyan) => {
    commitState();
    console.log(`${chalk.dim(label)}`);
  },

  // ── Timer ──────────────────────────────────────────────────

  formatDuration,

  timer: () => {
    const start = Date.now();
    return () => formatDuration(Date.now() - start);
  },

  // ── Centralised Project Details ────────────────────────────

  projectDetails: (opts: {
    source?:   string;
    output?:   string;
    engine?:   string;
    versions?: { count: number; labels: string };
    locales?:  { count: number; labels: string };
    threads?:  number;
    barColor?: typeof chalk.cyan;
  }) => {
    const bc = opts.barColor || chalk.cyan;
    if (opts.engine)   TUI.item('Engine',   opts.engine === 'rust' ? 'rust (preview)' : opts.engine, chalk.dim, bc);
    if (opts.source)   TUI.item('Source',   opts.source,                                          chalk.dim, bc);
    if (opts.output)   TUI.item('Output',   opts.output,                                          chalk.dim, bc);
    if (opts.versions) TUI.item('Versions', `${opts.versions.count} (${opts.versions.labels})`,   chalk.dim, bc);
    if (opts.locales)  TUI.item('Locales',  `${opts.locales.count} (${opts.locales.labels})`,     chalk.dim, bc);
    if (opts.threads)  TUI.item('Threads',  `${opts.threads}`,                                    chalk.dim, bc);
  },

  extractProjectDetails: (config: any, outputDir: string, cwd: string) => {
    const details: {
      source: string;
      output: string;
      engine?: string;
      versions?: { count: number; labels: string };
      locales?:  { count: number; labels: string };
    } = {
      source: (() => {
        const src = config.src || 'docs';
        if (path.isAbsolute(src)) {
          const rel = path.relative(cwd, src);
          const upCount = (rel.match(/\.\.\//g) || []).length;
          if (upCount > 3) {
            return src.endsWith('/') ? src : src + '/';
          }
          return rel.endsWith('/') ? rel : rel + '/';
        }
        return src.endsWith('/') ? src : src + '/';
      })(),
      output: (() => {
        const rel = path.relative(cwd, outputDir);
        const upCount = (rel.match(/\.\.\//g) || []).length;
        if (upCount > 3) {
          return outputDir.endsWith('/') ? outputDir : outputDir + '/';
        }
        return rel.endsWith('/') ? rel : rel + '/';
      })(),
    };

    if (config.engine && config.engine !== 'js') {
      details.engine = config.engine;
    }

    if (config.versions?.all?.length > 0) {
      details.versions = {
        count:  config.versions.all.length,
        labels: config.versions.all.map((v: any) => v.id).join(', '),
      };
    }

    if (config.i18n?.locales?.length > 0) {
      details.locales = {
        count:  config.i18n.locales.length,
        labels: config.i18n.locales.map((l: any) => l.id).join(', '),
      };
    }

    return details;
  },
};