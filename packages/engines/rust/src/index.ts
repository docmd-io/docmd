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

import { createRequire } from 'module';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require   = createRequire(import.meta.url);

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
}

// ---------------------------------------------------------------------------
// Platform Detection
// ---------------------------------------------------------------------------

type PlatformId = 'darwin-arm64' | 'darwin-x64' | 'linux-x64' | 'linux-arm64' | 'win32-x64';

const SUPPORTED: PlatformId[] = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64'];

const BINARY_NAMES: Record<PlatformId, string> = {
  'darwin-arm64': 'docmd-engine-darwin-arm64.node',
  'darwin-x64':   'docmd-engine-darwin-x64.node',
  'linux-x64':    'docmd-engine-linux-x64.node',
  'linux-arm64':  'docmd-engine-linux-arm64.node',
  'win32-x64':    'docmd-engine-win32-x64.node',
};

function detectPlatform(): PlatformId | null {
  const id = `${process.platform}-${process.arch}` as PlatformId;
  return SUPPORTED.includes(id) ? id : null;
}

// ---------------------------------------------------------------------------
// Binary Loading
// ---------------------------------------------------------------------------

function resolveBinaryPath(platformId: PlatformId): string {
  const name = BINARY_NAMES[platformId];
  // bin/ is sibling to dist/ (both under package root)
  const pkgRoot = path.join(__dirname, '..');
  const binaryPath = path.join(pkgRoot, 'bin', name);
  
  if (!fs.existsSync(binaryPath)) {
    throw new Error(
      `Rust engine binary not found: ${binaryPath}\n\n` +
      `Run: pnpm --filter @docmd/engine-rust run postinstall\n` +
      `Or the JS engine will be used as fallback.`
    );
  }
  
  return binaryPath;
}

interface NativeBindings {
  runTask(taskType: string, payloadJson: string): Promise<string>;
}

let _binding: NativeBindings | null = null;

function loadBinding(platformId: PlatformId): NativeBindings {
  if (_binding) return _binding;
  const binaryPath = resolveBinaryPath(platformId);
  _binding = require(binaryPath) as NativeBindings;
  return _binding;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function isRustEngineAvailable(): boolean {
  const platformId = detectPlatform();
  if (!platformId) return false;
  try {
    const name = BINARY_NAMES[platformId];
    const pkgRoot = path.join(__dirname, '..');
    return fs.existsSync(path.join(pkgRoot, 'bin', name));
  } catch {
    return false;
  }
}

export function createRustEngine(): Engine {
  const platformId = detectPlatform();
  
  if (!platformId) {
    throw new Error(
      `Rust engine not supported on ${process.platform}-${process.arch}.\n` +
      `Supported: ${SUPPORTED.join(', ')}`
    );
  }
  
  const binding = loadBinding(platformId);
  
  return {
    name: 'rust',
    version: '0.9.5',
    
    supports(taskType: string): boolean {
      return [
        'file:discover',
        'file:read',
        'file:readBatch',
        'file:write',
        'file:exists',
        'git:log',
        'git:status',
        'search:index'
      ].includes(taskType);
    },
    
    async run<T>(task: EngineTask): Promise<EngineResult<T>> {
      const start = Date.now();
      try {
        const raw  = await binding.runTask(task.type, JSON.stringify(task.payload));
        const data = JSON.parse(raw) as T;
        
        // Check if Rust returned an error object
        if (data && typeof data === 'object' && 'error' in data) {
          return { success: false, error: (data as any).error, duration: Date.now() - start };
        }
        
        return { success: true, data, duration: Date.now() - start };
      } catch (error) {
        return { success: false, error: (error as Error).message, duration: Date.now() - start };
      }
    },
  };
}
