import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure dist directory exists
const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Copy assets to dist/assets for standalone package consumption
const assetsSrcDir = path.join(__dirname, 'assets');
const assetsDistDir = path.join(distDir, 'assets');
if (fs.existsSync(assetsSrcDir)) {
  fs.cpSync(assetsSrcDir, assetsDistDir, { recursive: true });
}

console.log('✓ @docmd/plugin-playground build completed.');