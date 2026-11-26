import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function build() {
  await esbuild.build({
    // index.js is the docmd bundle (served as assets/js/threads.js); components.js is the portable
    // entry published as the "./components" export; emoji-picker.js is the lazy any-emoji picker that
    // threads-reactions import()s on the first + click (threads.js never imports it).
    entryPoints: [
      path.resolve(__dirname, 'src/client/index.ts'),
      path.resolve(__dirname, 'src/client/components.ts'),
      path.resolve(__dirname, 'src/client/emoji-picker.ts'),
    ],
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    format: 'esm',
    outdir: path.resolve(__dirname, 'dist/client'),
    minify: false,
    sourcemap: 'inline',
    loader: { '.css': 'css' },
    tsconfigRaw: JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false,
      },
    }),
  });
  copyEmojiAssets();
  console.log('Client built to dist/client/');
}

// Emoji data for the picker, served with the site as assets/threads/emoji/<lang>.json, and the licence
// texts that travel with the vendored picker (Apache-2.0 section 4) and its data.
const EMOJI_LANGS = ['en', 'hi', 'ko', 'zh'];

function copyEmojiAssets() {
  const out = path.resolve(__dirname, 'dist/client');
  const dataPkg = path.resolve(__dirname, 'node_modules/emoji-picker-element-data');
  fs.mkdirSync(path.join(out, 'emoji'), { recursive: true });
  for (const lang of EMOJI_LANGS) {
    // The package builds Emojibase-shortcode files for some languages only (en, zh); hi and ko ship
    // the same data with CLDR shortcodes, which the picker does not show.
    const source = ['emojibase', 'cldr']
      .map((flavour) => path.join(dataPkg, lang, flavour, 'data.json'))
      .find((file) => fs.existsSync(file));
    if (!source) throw new Error(`No emoji data for "${lang}" in emoji-picker-element-data`);
    fs.copyFileSync(source, path.join(out, 'emoji', `${lang}.json`));
  }
  fs.copyFileSync(path.join(dataPkg, 'LICENSE'), path.join(out, 'emoji', 'LICENSE'));
  fs.copyFileSync(
    path.resolve(__dirname, 'src/client/vendor/emoji-picker/LICENSE'),
    path.join(out, 'threads-emoji-picker.LICENSE.txt'),
  );
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
