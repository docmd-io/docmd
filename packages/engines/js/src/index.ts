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

import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types - self-contained, no external dependencies
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
}

// ---------------------------------------------------------------------------
// Task Handlers
// ---------------------------------------------------------------------------

type TaskHandler = (payload: any) => Promise<any>;

const SKIP_DIRS = new Set(['node_modules', '.git', '.docmd', 'dist', 'site']);

const handlers: Record<string, TaskHandler> = {

  // --- File Operations ---

  'file:discover': async ({ dir, extensions, exclude }) => {
    const results: Array<{ path: string; size: number; mtimeMs: number }> = [];
    const extSet = extensions ? new Set<string>(extensions) : null;
    const skipSet: Set<string> = exclude ? new Set([...SKIP_DIRS, ...exclude]) : SKIP_DIRS;

    async function walk(currentDir: string): Promise<void> {
      let entries;
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }
      await Promise.all(entries.map(async (entry) => {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          if (!skipSet.has(entry.name)) await walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (!extSet || extSet.has(ext) || extSet.has(entry.name)) {
            try {
              const stat = await fs.stat(fullPath);
              results.push({ path: fullPath, size: stat.size, mtimeMs: stat.mtimeMs });
            } catch { /* skip inaccessible files */ }
          }
        }
      }));
    }

    await walk(dir);
    return results;
  },

  'file:read': async ({ path: filePath }) => {
    return fs.readFile(filePath, 'utf-8');
  },

  'file:readBatch': async ({ paths }) => {
    const results: Record<string, string> = {};
    await Promise.all((paths as string[]).map(async (p) => {
      try {
        results[p] = await fs.readFile(p, 'utf-8');
      } catch {
        results[p] = '';
      }
    }));
    return results;
  },

  'file:write': async ({ path: filePath, content }) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
    return { success: true };
  },

  'file:exists': async ({ path: filePath }) => {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  },

  // --- Git Operations ---

  'git:log': async ({ filePaths, maxCommits = 6 }) => {
    const results: Record<string, any[]> = {};
    await Promise.all((filePaths as string[]).map(async (filePath) => {
      try {
        const { stdout } = await execFileAsync('git', [
          'log', '--follow', '-n', String(maxCommits),
          '--format=%H|%h|%an|%ae|%at|%s', '--', filePath,
        ], { cwd: process.cwd() });
        results[filePath] = stdout.trim()
          ? stdout.trim().split('\n').map((line) => {
              const [hash, shortHash, author, email, timestamp, ...msg] = line.split('|');
              return { hash, shortHash, author, email, timestamp: parseInt(timestamp, 10) * 1000, message: msg.join('|') };
            })
          : [];
      } catch {
        results[filePath] = [];
      }
    }));
    return results;
  },

  'git:status': async () => {
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: process.cwd() });
      return stdout.trim().split('\n').filter(Boolean).map((line) => ({
        status: line.slice(0, 2).trim(),
        path: line.slice(3),
      }));
    } catch {
      return [];
    }
  },

  // --- Search Operations ---

  'search:index': async ({ documents }) => {
    const index = {
      documents: (documents as any[]).map((doc) => ({
        id: doc.id,
        title: (doc.title as string).toLowerCase(),
        content: (doc.content as string).toLowerCase().slice(0, 5000),
        path: doc.path,
        locale: doc.locale,
        version: doc.version,
      })),
      builtAt: Date.now(),
    };
    return JSON.stringify(index);
  },

  // ── docmd-search semantic tasks ──────────────────────────────────────────

  /**
   * search:chunk — Split a document into overlapping chunks by heading + word count.
   * payload: { text, file, chunkSize?, chunkOverlap? }
   * returns: Array<{ file, heading?, text, range: [start, end] }>
   */
  'search:chunk': async ({ text, file, chunkSize = 256, chunkOverlap = 32 }) => {
    const chunks: Array<{ file: string; heading?: string; text: string; range: [number, number] }> = [];
    let currentHeading: string | undefined;
    let currentWords: string[] = [];
    let currentStart = 0;
    let bytePos = 0;

    for (const line of (text as string).split('\n')) {
      const lineBytes = line.length + 1;

      if (/^#{1,6}\s/.test(line)) {
        // Flush current chunk before heading
        if (currentWords.length > 0) {
          chunks.push({ file, heading: currentHeading, text: currentWords.join(' '), range: [currentStart, bytePos] });
          currentWords = currentWords.slice(-chunkOverlap);
          currentStart = bytePos;
        }
        currentHeading = line.replace(/^#+\s*/, '').trim();
      } else {
        const words = line.split(/\s+/).filter(Boolean);
        currentWords.push(...words);

        if (currentWords.length >= chunkSize) {
          chunks.push({ file, heading: currentHeading, text: currentWords.join(' '), range: [currentStart, bytePos + lineBytes] });
          currentWords = currentWords.slice(-chunkOverlap);
          currentStart = bytePos;
        }
      }

      bytePos += lineBytes;
    }

    if (currentWords.length > 0) {
      chunks.push({ file, heading: currentHeading, text: currentWords.join(' '), range: [currentStart, bytePos] });
    }

    return chunks;
  },

  /**
   * search:quantize — Float32 → Int8 per-vector quantization.
   * payload: { vectors: number[][], dimensions: number }
   * returns: { quantized: number[][], mins: number[], ranges: number[] }
   */
  'search:quantize': async ({ vectors, dimensions = 384 }) => {
    const quantized: number[][] = [];
    const mins: number[] = [];
    const ranges: number[] = [];

    for (const vec of (vectors as number[][])) {
      const v = vec.length === dimensions ? vec : Array.from({ length: dimensions }, (_, i) => vec[i] ?? 0);
      const min = Math.min(...v);
      const max = Math.max(...v);
      const range = Math.abs(max - min) < 1e-10 ? 1.0 : max - min;

      const q = v.map(x => Math.round(((x - min) / range) * 255 - 128));
      quantized.push(q);
      mins.push(min);
      ranges.push(range);
    }

    return { quantized, mins, ranges };
  },

  /**
   * search:cosine — Batch cosine similarity between a query vector and a corpus.
   * payload: { query: number[], vectors: number[][], topK?: number }
   * returns: Array<{ index: number, score: number }>
   */
  'search:cosine': async ({ query, vectors, topK = 10 }) => {
    const q = query as number[];
    const qNorm = Math.sqrt(q.reduce((s: number, v: number) => s + v * v, 0));
    if (qNorm < 1e-10) return [];

    const scores = (vectors as number[][]).map((vec, idx) => {
      const dot = q.reduce((s: number, v: number, i: number) => s + v * (vec[i] ?? 0), 0);
      const vNorm = Math.sqrt(vec.reduce((s: number, v: number) => s + v * v, 0));
      const sim = vNorm < 1e-10 ? 0 : dot / (qNorm * vNorm);
      return { index: idx, score: sim };
    });

    return scores.sort((a, b) => b.score - a.score).slice(0, topK);
  },
};

// ---------------------------------------------------------------------------
// Engine Factory
// ---------------------------------------------------------------------------

/**
 * Create a JavaScript engine instance.
 *
 * The JS engine uses only Node.js built-in APIs — no external dependencies,
 * no native binaries. Works on every platform and Node.js version docmd supports.
 */
export function createJsEngine(): Engine {
  return {
    name: 'js',
    version: '0.9.5',

    supports(taskType: string): boolean {
      return taskType in handlers;
    },

    async run<T>(task: EngineTask): Promise<EngineResult<T>> {
      const start = Date.now();
      try {
        const handler = handlers[task.type];
        if (!handler) {
          return { success: false, error: `Unknown task type: '${task.type}'`, duration: Date.now() - start };
        }
        const data = await handler(task.payload);
        return { success: true, data, duration: Date.now() - start };
      } catch (error) {
        return { success: false, error: (error as Error).message, duration: Date.now() - start };
      }
    },
  };
}

// Engine, EngineTask, and EngineResult are declared above as exported interfaces.
