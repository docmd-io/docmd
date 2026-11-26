import esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function build() {
  await esbuild.build({
    // index.js is the docmd bundle (served as assets/js/threads.js); components.js is the portable
    // entry published as the "./components" export.
    entryPoints: [
      path.resolve(__dirname, 'src/client/index.ts'),
      path.resolve(__dirname, 'src/client/components.ts'),
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
  console.log('Client built to dist/client/');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
