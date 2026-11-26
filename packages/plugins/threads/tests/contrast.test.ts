import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Contrast of the threads text tokens in every look the visual suite covers, computed from the declared
 * formulas in threads.css and the values each template and theme gives the host variables.
 */

const css = fs
  .readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'client', 'threads.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

type Rgb = [number, number, number];

const NAMED: Record<string, string> = { black: '#000000', white: '#ffffff', silver: '#c0c0c0' };
const hex = (c: string): Rgb => {
  const h = (NAMED[c] ?? c).replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
};
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function toOklab([r, g, b]: Rgb): Rgb {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function fromOklab([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((v) => Math.min(1, Math.max(0, fromLinear(v)))) as Rgb;
}
/** color-mix(in oklab, a pct%, b) */
const mix = (a: Rgb, pct: number, b: Rgb): Rgb => {
  const [x, y] = [toOklab(a), toOklab(b)];
  return fromOklab(x.map((v, i) => v * pct + y[i]! * (1 - pct)) as Rgb);
};
/** A colour at `alpha` painted over an opaque backdrop. */
const over = (c: Rgb, alpha: number, bg: Rgb): Rgb => c.map((v, i) => v * alpha + bg[i]! * (1 - alpha)) as Rgb;
const luminance = ([r, g, b]: Rgb) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
const ratio = (a: Rgb, b: Rgb) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

/** The percentage and the mix target of a token declared as color-mix(in oklab, <base> N%, <target>). */
function formula(token: string, selector: string): { pct: number; target: string } {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf('\n}', start));
  const decl = body.match(new RegExp(`--threads-${token}:([^;]*);`))?.[1] ?? '';
  const m = decl.match(/color-mix\(in oklab,[\s\S]*?\)?\)?\s+(\d+)%,\s*(.+)\)\s*$/);
  assert.ok(m, `--threads-${token} is a color-mix formula in ${selector}`);
  return { pct: Number(m[1]) / 100, target: m[2]!.trim() };
}

interface Look {
  name: string;
  mode: 'light' | 'dark';
  /** What the host gives: text, muted text, page/card surface, tinted surface (quote), accent. */
  fg: string;
  muted: string;
  surface: string;
  surfaceMuted: string;
  accent: string;
  /** The accent tint as the look paints it (a literal in the summer template, else 14% of the accent). */
  accentSoft?: string;
}

// Values read from the running site in each look.
const looks: Look[] = [
  { name: 'default', mode: 'light', fg: '#1f1f20', muted: '#6b6b75', surface: '#ffffff', surfaceMuted: '#fafafa', accent: '#068ad5' },
  { name: 'default', mode: 'dark', fg: '#d4d4d8', muted: '#94949e', surface: '#0d0d0f', surfaceMuted: '#111113', accent: '#38bdf8' },
  { name: 'retro', mode: 'light', fg: '#111111', muted: '#4d4d4d', surface: '#fdf6e3', surfaceMuted: '#fffcf3', accent: '#b37b00' },
  { name: 'retro', mode: 'dark', fg: '#e0e0e0', muted: '#888888', surface: '#121212', surfaceMuted: '#0a0a0a', accent: '#33ff33' },
  { name: 'ruby', mode: 'light', fg: '#2d2d2d', muted: '#5a5a5a', surface: '#ffffff', surfaceMuted: '#f8f5f5', accent: '#b30000' },
  { name: 'ruby', mode: 'dark', fg: '#f0f0f0', muted: 'silver', surface: '#1a0a0a', surfaceMuted: '#1a0a0a', accent: '#ff5252' },
  { name: 'sky', mode: 'light', fg: '#1a1f36', muted: '#4a5568', surface: '#ffffff', surfaceMuted: '#f7fafc', accent: '#0097ff' },
  { name: 'sky', mode: 'dark', fg: '#f1f5f9', muted: '#cbd5e1', surface: '#0f172a', surfaceMuted: '#0f172a', accent: '#3b82f6' },
  { name: 'summer', mode: 'light', fg: '#1d1d1d', muted: '#6e6e6e', surface: '#ffffff', surfaceMuted: '#f1f1ef', accent: '#fe551b', accentSoft: '#fff3ed' },
  { name: 'summer', mode: 'dark', fg: '#f5f0e6', muted: '#8a8473', surface: '#1d1b17', surfaceMuted: '#2c2820', accent: '#ff8a5c', accentSoft: '#2a1810' },
  // The literal fallbacks of the tokens when the host declares nothing
  { name: 'no host variables', mode: 'light', fg: '#1f1f20', muted: '#6b6b75', surface: '#ffffff', surfaceMuted: '#fafafa', accent: '#068ad5' },
  // A weak host muted colour (the failing case that motivated the formula: 3.6:1 on a tinted card)
  { name: 'weak muted', mode: 'light', fg: '#1d1d1d', muted: '#808080', surface: '#ffffff', surfaceMuted: '#f1f1ef', accent: '#fe551b' },
  { name: 'weak muted', mode: 'dark', fg: '#f5f0e6', muted: '#7e7868', surface: '#1d1b17', surfaceMuted: '#2c2820', accent: '#ff8a5c' },
];

const muted = formula('fg-muted', ':root');
const accentStrong = { light: formula('accent-strong', ':root'), dark: formula('accent-strong', ':root[data-theme="dark"]') };

for (const look of looks) {
  test(`contrast: ${look.name} ${look.mode}`, () => {
    const fg = hex(look.fg);
    const surface = hex(look.surface);
    const surfaceMuted = hex(look.surfaceMuted);
    const raised = mix(fg, 0.03, surface);
    const fgMuted = mix(hex(look.muted), muted.pct, fg);

    for (const [label, bg] of [['surface', surface], ['surface-muted', surfaceMuted], ['surface-raised', raised]] as const) {
      assert.ok(ratio(fgMuted, bg) >= 4.5, `muted text on ${label}: ${ratio(fgMuted, bg).toFixed(2)}:1`);
    }

    const a = accentStrong[look.mode];
    const strong = mix(hex(look.accent), a.pct, hex(a.target));
    const soft = look.accentSoft ? hex(look.accentSoft) : over(hex(look.accent), 0.14, surface);
    assert.ok(ratio(strong, surface) >= 4.5, `accent-strong on surface: ${ratio(strong, surface).toFixed(2)}:1`);
    assert.ok(ratio(strong, soft) >= 4.5, `accent-strong on accent-soft: ${ratio(strong, soft).toFixed(2)}:1`);
  });
}
