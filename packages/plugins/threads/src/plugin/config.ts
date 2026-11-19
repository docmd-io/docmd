import { ThreadsError } from './errors.js';

export interface ThreadsOptions {
  sidebar: boolean;
  /** `false`: collect-only. Otherwise drafts publish `seconds` after the last edit while a user's mode is auto. */
  autoPublish: false | { seconds: number; startOn: boolean };
}

const bad = (key: string, why: string): never => {
  const where = key ? `plugins.threads.${key}` : 'plugins.threads';
  throw new ThreadsError('config', `${where} ${why}`);
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A sub-object option: absent gives {}, anything else must be an object. */
function section(raw: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = raw[key];
  if (v === undefined) return {};
  if (!isObject(v)) bad(key, 'must be an object');
  return v as Record<string, unknown>;
}

function positiveNumber(obj: Record<string, unknown>, path: string, key: string, def: number): number {
  const v = obj[key] ?? def;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) bad(`${path}.${key}`, 'must be a positive number');
  return v as number;
}

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

  let autoPublish: ThreadsOptions['autoPublish'];
  if (raw.autoPublish === false) {
    autoPublish = false;
  } else {
    const ap = section(raw, 'autoPublish');
    const startOn = ap.startOn ?? true;
    if (typeof startOn !== 'boolean') bad('autoPublish.startOn', 'must be a boolean');
    autoPublish = { seconds: positiveNumber(ap, 'autoPublish', 'seconds', 180), startOn: startOn as boolean };
  }

  return {
    sidebar: optionalBoolean(raw, 'sidebar', false),
    autoPublish,
  };
}

/** The normalized plugin options for the project an action call belongs to. */
export function getOptions(ctx: { config?: { plugins?: { threads?: unknown } } }): ThreadsOptions {
  return normalizeOptions(ctx.config?.plugins?.threads);
}
