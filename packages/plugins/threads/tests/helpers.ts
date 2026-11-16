import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { safePath } from '@docmd/utils';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = safePath(path.resolve(here, '..'), 'e2e/fixtures/playground-index.md');
/** The playground page, read once. */
export const playground = fs.readFileSync(FIXTURE, 'utf8');

/** markdown-it is a dependency of @docmd/parser, not of this plugin. */
function loadMarkdownIt() {
  try {
    return createRequire(path.resolve(here, '..', '..', '..', 'parser', 'package.json'))('markdown-it');
  } catch (err) {
    throw new Error(`markdown-it not resolvable via @docmd/parser (packages/parser moved or dropped it?): ${err}`);
  }
}
export const MarkdownIt = loadMarkdownIt();

export interface TempProject {
  root: string;
  /** Relative path of the page the fixture is copied to. */
  file: string;
  /** Rewrite docs/index.md from the fixture. */
  reset(): void;
  /** Remove the temp directory. */
  cleanup(): void;
}

/** Temp dir holding docs/index.md copied from the playground fixture. */
export function tempProject(): TempProject {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test-'));
  const file = path.join('docs', 'index.md');
  fs.mkdirSync(safePath(root, 'docs'), { recursive: true });
  const reset = () => fs.copyFileSync(FIXTURE, safePath(root, file));
  reset();
  return { root, file, reset, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

export interface TestCtx {
  projectRoot: string;
  config: Record<string, unknown>;
  broadcast(event: string, data: unknown): void;
  source: { _modified: boolean };
  readFile(relativePath: string): Promise<string>;
  writeFile(relativePath: string, content: string): Promise<void>;
  readFileLines(relativePath: string): Promise<string[]>;
}

/** Action context matching what the action dispatcher provides. */
export function makeCtx(root: string, extra: Partial<TestCtx> = {}): TestCtx {
  const ctx: TestCtx = {
    projectRoot: root,
    config: {},
    broadcast: () => {},
    source: { _modified: false },
    async readFile(relativePath: string) {
      return fs.promises.readFile(safePath(root, relativePath), 'utf8');
    },
    async writeFile(relativePath: string, content: string) {
      await fs.promises.writeFile(safePath(root, relativePath), content);
      ctx.source._modified = true;
    },
    async readFileLines(relativePath: string) {
      return (await ctx.readFile(relativePath)).split('\n');
    },
    ...extra,
  };
  return ctx;
}
