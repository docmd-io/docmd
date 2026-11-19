import { ThreadsError } from './errors.js';

export interface ThreadsOptions {
  sidebar: boolean;
}

const bad = (key: string, why: string): never => {
  const where = key ? `plugins.threads.${key}` : 'plugins.threads';
  throw new ThreadsError('config', `${where} ${why}`);
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function optionalBoolean(obj: Record<string, unknown>, key: string, def: boolean): boolean {
  const v = obj[key] ?? def;
  if (typeof v !== 'boolean') bad(key, 'must be a boolean');
  return v as boolean;
}

/**
 * Turn the raw `plugins.threads` value (object, `true`, or absent) into a
 * complete ThreadsOptions. Pure: no I/O.
 */
export function normalizeOptions(rawInput?: unknown): ThreadsOptions {
  if (rawInput !== undefined && rawInput !== true && rawInput !== null && !isObject(rawInput)) {
    bad('', 'must be an object');
  }
  const raw: Record<string, unknown> = isObject(rawInput) ? rawInput : {};

  return {
    sidebar: optionalBoolean(raw, 'sidebar', false),
  };
}
