/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * @package     @docmd/engine-python
 * @website     https://docmd.io
 * @repository  https://github.com/docmd-io/docmd
 * @license     MIT
 * @copyright   Copyright (c) 2025-present docmd.io
 *
 * [docmd-source] - Please do not remove this header.
 * --------------------------------------------------------------------
 */

import { spawn, execFileSync, execFile, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import * as readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EngineTask {
  type: string;
  payload: any;
  timeout?: number;
}

export interface EngineResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  duration?: number;
}

export interface Engine {
  readonly name: string;
  readonly version: string;
  run<T = any>(task: EngineTask): Promise<EngineResult<T>>;
  supports?(taskType: string): boolean;
  shutdown?(): void;
  destroy?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Supported Task Types
// ---------------------------------------------------------------------------

const SUPPORTED_TASKS = new Set([
  'file:discover',
  'file:read',
  'file:readBatch',
  'file:write',
  'file:exists',
  'git:log',
  'git:status',
  'search:index',
  'search:chunk',
  'search:quantize',
  'search:cosine',
]);

// ---------------------------------------------------------------------------
// Python Runtime Resolution
// ---------------------------------------------------------------------------

let _cachedPythonBin: string | null | undefined = undefined;

/**
 * Locate a working Python 3 executable on the system.
 * Checks DOCMD_PYTHON environment variable, then python3, then python.
 */
export function findPythonBinary(): string | null {
  if (_cachedPythonBin !== undefined) return _cachedPythonBin;

  if (process.env.DOCMD_PYTHON) {
    try {
      execFileSync(process.env.DOCMD_PYTHON, ['-c', 'import sys; assert sys.version_info >= (3, 8)'], { stdio: 'ignore' });
      _cachedPythonBin = process.env.DOCMD_PYTHON;
      return _cachedPythonBin;
    } catch {
      // Configured python is invalid, fall through to auto-detection
    }
  }

  for (const bin of ['python3', 'python']) {
    try {
      execFileSync(bin, ['-c', 'import sys; assert sys.version_info >= (3, 8)'], { stdio: 'ignore' });
      _cachedPythonBin = bin;
      return _cachedPythonBin;
    } catch {
      // try next
    }
  }

  _cachedPythonBin = null;
  return null;
}

/**
 * Check if the Python engine is available on the current system.
 */
export function isPythonEngineAvailable(): boolean {
  return findPythonBinary() !== null;
}

function resolveRunnerPath(): string {
  const pkgRoot = path.join(__dirname, '..');
  const candidate = path.join(pkgRoot, 'python', 'runner.py');
  if (fs.existsSync(candidate)) return candidate;

  // Development/build fallback
  const alt = path.resolve(pkgRoot, '..', 'python', 'python', 'runner.py');
  if (fs.existsSync(alt)) return alt;

  return candidate;
}

// ---------------------------------------------------------------------------
// Persistent Python Worker Process (Line-delimited JSON-RPC)
// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (result: EngineResult<any>) => void;
  reject: (err: Error) => void;
  timer?: NodeJS.Timeout;
  start: number;
}

class PythonWorkerPool {
  private worker: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private pending = new Map<string, PendingRequest>();
  private reqIdCounter = 0;
  private pythonBin: string;
  private runnerPath: string;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(pythonBin: string, runnerPath: string) {
    this.pythonBin = pythonBin;
    this.runnerPath = runnerPath;
  }

  private scheduleIdleTimeout(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.pending.size === 0) {
        this.cleanup();
      }
    }, 1500);
    if (this.idleTimer && typeof this.idleTimer.unref === 'function') {
      this.idleTimer.unref();
    }
  }

  private startWorker(): ChildProcess {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.worker && !this.worker.killed) return this.worker;

    const child = spawn(this.pythonBin, [this.runnerPath, '--listen'], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    child.on('error', (err) => {
      this.rejectAll(`Python worker error: ${err.message}`);
      this.cleanup();
    });

    child.on('exit', (_code, _signal) => {
      this.rejectAll(`Python worker exited unexpectedly`);
      this.cleanup();
    });

    const rl = readline.createInterface({ input: child.stdout! });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed);
        const req = this.pending.get(msg.id);
        if (req) {
          this.pending.delete(msg.id);
          if (req.timer) clearTimeout(req.timer);
          const duration = msg.duration ?? (Date.now() - req.start);
          if (msg.success) {
            req.resolve({ success: true, data: msg.data, duration });
          } else {
            req.resolve({ success: false, error: msg.error || 'Python task error', duration });
          }
          if (this.pending.size === 0) {
            this.scheduleIdleTimeout();
          }
        }
      } catch (e: any) {
        // Line wasn't valid JSON, ignore
      }
    });

    this.worker = child;
    this.rl = rl;
    return child;
  }

  private rejectAll(errorMsg: string): void {
    for (const [id, req] of this.pending.entries()) {
      if (req.timer) clearTimeout(req.timer);
      req.resolve({ success: false, error: errorMsg, duration: Date.now() - req.start });
    }
    this.pending.clear();
    this.scheduleIdleTimeout();
  }

  public cleanup(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.rl) {
      try { this.rl.close(); } catch { /* ignore */ }
      this.rl = null;
    }
    if (this.worker) {
      try {
        if (!this.worker.killed) {
          this.worker.kill();
        }
      } catch { /* ignore */ }
      this.worker = null;
    }
  }

  public async runTask<T>(task: EngineTask): Promise<EngineResult<T>> {
    const start = Date.now();
    const id = `req_${++this.reqIdCounter}`;

    try {
      const child = this.startWorker();
      if (!child.stdin || child.stdin.destroyed) {
        throw new Error('Python worker stdin unavailable');
      }
      const stdin = child.stdin;

      return await new Promise<EngineResult<T>>((resolve, reject) => {
        const timeoutMs = task.timeout || 60000;
        const timer = setTimeout(() => {
          this.pending.delete(id);
          if (this.pending.size === 0) this.scheduleIdleTimeout();
          resolve({ success: false, error: `Python task '${task.type}' timed out after ${timeoutMs}ms`, duration: Date.now() - start });
        }, timeoutMs);

        this.pending.set(id, { resolve, reject, timer, start });

        const payloadStr = JSON.stringify({ id, type: task.type, payload: task.payload });
        stdin.write(payloadStr + '\n', 'utf8', (err) => {
          if (err) {
            clearTimeout(timer);
            this.pending.delete(id);
            if (this.pending.size === 0) this.scheduleIdleTimeout();
            resolve({ success: false, error: `Failed to write to Python worker: ${err.message}`, duration: Date.now() - start });
          }
        });
      });
    } catch (err: any) {
      // Fallback to one-shot execution if persistent worker failed
      return this.runOneShot<T>(task);
    }
  }

  private runOneShot<T>(task: EngineTask): Promise<EngineResult<T>> {
    const start = Date.now();
    return new Promise<EngineResult<T>>((resolve) => {
      const payloadJson = JSON.stringify(task.payload ?? {});
      execFile(
        this.pythonBin,
        [this.runnerPath, task.type, payloadJson],
        { maxBuffer: 100 * 1024 * 1024, timeout: task.timeout || 60000 },
        (error, stdout, stderr) => {
          const duration = Date.now() - start;
          if (error) {
            return resolve({
              success: false,
              error: stderr?.trim() || error.message,
              duration,
            });
          }
          try {
            const parsed = JSON.parse(stdout.trim());
            resolve({
              success: parsed.success ?? true,
              data: parsed.data,
              error: parsed.error,
              duration: parsed.duration ?? duration,
            });
          } catch (e: any) {
            resolve({
              success: false,
              error: `Invalid output from Python engine: ${e.message}`,
              duration,
            });
          }
        }
      );
    });
  }
}

// ---------------------------------------------------------------------------
// Engine Factory
// ---------------------------------------------------------------------------

let _globalWorkerPool: PythonWorkerPool | null = null;

function getWorkerPool(pythonBin: string, runnerPath: string): PythonWorkerPool {
  if (!_globalWorkerPool) {
    _globalWorkerPool = new PythonWorkerPool(pythonBin, runnerPath);
    process.once('exit', () => {
      if (_globalWorkerPool) {
        _globalWorkerPool.cleanup();
        _globalWorkerPool = null;
      }
    });
  }
  return _globalWorkerPool;
}

/**
 * Create a Python engine instance.
 *
 * The Python engine delegates file, git, and search indexing tasks to a
 * Python 3 runtime via an optimized stdio worker process.
 */
export function createPythonEngine(): Engine {
  const pythonBin = findPythonBinary();
  if (!pythonBin) {
    throw new Error(
      `Python 3 (>= 3.8) not found on system PATH.\n` +
      `Install Python 3 or specify the binary via DOCMD_PYTHON environment variable.\n` +
      `Or the JS engine will be used as fallback.`
    );
  }

  const runnerPath = resolveRunnerPath();
  if (!fs.existsSync(runnerPath)) {
    throw new Error(`Python runner script not found at ${runnerPath}`);
  }

  const pool = getWorkerPool(pythonBin, runnerPath);

  return {
    name: 'python',
    version: '0.9.9',

    supports(taskType: string): boolean {
      return SUPPORTED_TASKS.has(taskType);
    },

    async run<T>(task: EngineTask): Promise<EngineResult<T>> {
      if (!SUPPORTED_TASKS.has(task.type)) {
        return {
          success: false,
          error: `Task type '${task.type}' is not supported by the Python engine.`,
        };
      }
      return pool.runTask<T>(task);
    },

    shutdown(): void {
      shutdownPythonEngine();
    },

    async destroy(): Promise<void> {
      shutdownPythonEngine();
    },
  };
}

export function shutdownPythonEngine(): void {
  if (_globalWorkerPool) {
    _globalWorkerPool.cleanup();
    _globalWorkerPool = null;
  }
}