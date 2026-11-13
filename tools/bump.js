/**
 * --------------------------------------------------------------------
 * docmd : the minimalist, zero-config documentation generator.
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

const fs = require("fs");
const path = require("path");

const newVersion = process.argv[2];

if (!newVersion) {
  console.error("Usage: node tools/bump-version.js <new-version>");
  process.exit(1);
}

const root = process.cwd();
const packagesDir = path.join(root, "packages");

function updateVersion(pkgPath) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  console.log(`Updated: ${pkg.name} → ${newVersion}`);
}

function updateSourceVersion(pkgDir) {
  const indexPath = path.join(pkgDir, "src", "index.ts");
  if (fs.existsSync(indexPath)) {
    let content = fs.readFileSync(indexPath, "utf8");
    const versionRegex = /version:\s*(['"])(.*?)(['"])/g;
    // Update any file in src/index.ts that has a version property
    if (versionRegex.test(content)) {
      content = content.replace(versionRegex, `version: $1${newVersion}$3`);
      fs.writeFileSync(indexPath, content);
      console.log(`Updated Source Version: ${path.basename(pkgDir)} → ${newVersion}`);
    }
  }
}

function updateCargoVersion(pkgDir) {
  const cargoPath = path.join(pkgDir, "native", "Cargo.toml");
  if (fs.existsSync(cargoPath)) {
    let content = fs.readFileSync(cargoPath, "utf8");
    const versionRegex = /version\s*=\s*(['"])(.*?)(['"])/;
    if (versionRegex.test(content)) {
      content = content.replace(versionRegex, `version     = "${newVersion}"`);
      fs.writeFileSync(cargoPath, content);
      console.log(`Updated Cargo Version: ${path.basename(pkgDir)} → ${newVersion}`);
    }
  }
}

function updateDockerVersion() {
  // Update Docker workflow if it exists
  const dockerWorkflowPath = path.join(root, ".github", "workflows", "docker-publish.yml");
  if (fs.existsSync(dockerWorkflowPath)) {
    let content = fs.readFileSync(dockerWorkflowPath, "utf8");
    // Update any hardcoded version references in comments or examples
    // This is mainly for documentation purposes in the workflow
    const versionCommentRegex = /# Version:\s*v?[\d.]+/g;
    if (versionCommentRegex.test(content)) {
      content = content.replace(versionCommentRegex, `# Version: v${newVersion}`);
      fs.writeFileSync(dockerWorkflowPath, content);
      console.log(`Updated Docker Workflow Version → ${newVersion}`);
    }
  }
}

function updateEcosystemFallbacks(v) {
  // 1. packages/parser/src/variables/registry.ts fallback
  const regPath = path.join(packagesDir, 'parser', 'src', 'variables', 'registry.ts');
  if (fs.existsSync(regPath)) {
    let content = fs.readFileSync(regPath, 'utf8');
    content = content.replace(/return\s*['"][\d.]+['"];(\s*\/\/\s*Fallback|\s*})/i, `return '${v}';$1`);
    fs.writeFileSync(regPath, content);
    console.log(`Updated Registry Fallback → ${v}`);
  }

  // 2. packages/live/src/browser-entry.ts
  const liveEntry = path.join(packagesDir, 'live', 'src', 'browser-entry.ts');
  if (fs.existsSync(liveEntry)) {
    let content = fs.readFileSync(liveEntry, 'utf8');
    content = content.replace(/(const LIVE_VERSION = typeof __DOCMD_VERSION__ !== 'undefined' \? __DOCMD_VERSION__ : )['"][\d.]+['"]/, `$1'${v}'`);
    fs.writeFileSync(liveEntry, content);
    console.log(`Updated Live Browser Entry Fallback → ${v}`);
  }

  // 3. packages/ui/assets/js/docmd-runtime.js
  const runtimePath = path.join(packagesDir, 'ui', 'assets', 'js', 'docmd-runtime.js');
  if (fs.existsSync(runtimePath)) {
    let content = fs.readFileSync(runtimePath, 'utf8');
    content = content.replace(/(this\.version = injected\.docmd\?\.version \|\| injected\.DOCMD_VERSION \|\| )['"][\d.]+['"]/, `$1'${v}'`);
    content = content.replace(/(return this\._runtime\.version \|\| )['"][\d.]+['"]/, `$1'${v}'`);
    content = content.replace(/(version: this\._runtime\.version \|\| )['"][\d.]+['"]/, `$1'${v}'`);
    fs.writeFileSync(runtimePath, content);
    console.log(`Updated docmd-runtime.js Fallback → ${v}`);
  }

  // 4. packages/plugins/playground/assets/js/playground.js
  const pgPath = path.join(packagesDir, 'plugins', 'playground', 'assets', 'js', 'playground.js');
  if (fs.existsSync(pgPath)) {
    let content = fs.readFileSync(pgPath, 'utf8');
    content = content.replace(/(version: window\.docmd\?\.version \|\| )['"][\d.]+['"]/, `$1'${v}'`);
    content = content.replace(/(version: docmdData\.version \|\| )['"][\d.]+['"]/, `$1'${v}'`);
    content = content.replace(/(window\.docmd\.version = injectedVars\.docmd\?\.version \|\| injectedVars\.DOCMD_VERSION \|\| )['"][\d.]+['"]/, `$1'${v}'`);
    fs.writeFileSync(pgPath, content);
    console.log(`Updated Playground Fallback → ${v}`);
  }

  // 5. packages/templates/summer/templates/layout.ejs
  const layoutPath = path.join(packagesDir, 'templates', 'summer', 'templates', 'layout.ejs');
  if (fs.existsSync(layoutPath)) {
    let content = fs.readFileSync(layoutPath, 'utf8');
    content = content.replace(/(coreVersion\s*:\s*)['"][\d.]+['"]/, `$1'${v}'`);
    fs.writeFileSync(layoutPath, content);
    console.log(`Updated Summer Layout Fallback → ${v}`);
  }

  // 6. packages/live/src/index.html
  const liveHtml = path.join(packagesDir, 'live', 'src', 'index.html');
  if (fs.existsSync(liveHtml)) {
    let content = fs.readFileSync(liveHtml, 'utf8');
    content = content.replace(/<meta name="generator" content="docmd v[\d.]+">/, `<meta name="generator" content="docmd v${v}">`);
    fs.writeFileSync(liveHtml, content);
    console.log(`Updated Live HTML Generator Tag → ${v}`);
  }
}

// 1️⃣ Update root
updateVersion(path.join(root, "package.json"));

// 2️⃣ Update Docker version references
updateDockerVersion();

// 3️⃣ Update ecosystem fallback strings
updateEcosystemFallbacks(newVersion);

// 4️⃣ Recursively update all packages
function walk(dir) {
  for (const entry of fs.readdirSync(dir)) {
    if (['node_modules', 'dist', '.build'].includes(entry)) continue;

    const full = path.join(dir, entry);

    if (fs.existsSync(path.join(full, "package.json"))) {
      updateVersion(path.join(full, "package.json"));
      updateSourceVersion(full);
      updateCargoVersion(full);
    } else if (fs.statSync(full).isDirectory()) {
      walk(full);
    }
  }
}

walk(packagesDir);

console.log("Version bump complete.");