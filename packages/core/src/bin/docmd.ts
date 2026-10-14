#!/usr/bin/env node

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

import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { initProject } from '../commands/init.js';
import { buildSite } from '../commands/build.js';
import { startDevServer } from '../commands/dev.js';
import { buildLive } from '../commands/live.js';
import { migrateProject } from '../commands/migrate.js';
import { stopServer } from '../commands/stop.js';
import { initDeploy } from '../commands/deploy.js';
import { runMcpServer } from '../commands/mcp.js';
import { validateProject } from '../commands/validate.js';

import { TUI } from '@docmd/api';
import { installPlugin, removePlugin } from '@docmd/plugin-installer';

const pkgUrl = new URL('../../package.json', import.meta.url);
const { version } = JSON.parse(readFileSync(pkgUrl, 'utf-8'));

const args = process.argv.slice(2);

const options = {
  config: { type: 'string', short: 'c' },
  offline: { type: 'boolean' },
  port: { type: 'string', short: 'p' },
  'build-only': { type: 'boolean' },
  cwd: { type: 'string' },
  verbose: { type: 'boolean', short: 'V' },
  version: { type: 'boolean', short: 'v' },
  help: { type: 'boolean', short: 'h' },
  force: { type: 'boolean' },
  yes: { type: 'boolean', short: 'y' },
  json: { type: 'boolean' }
} as const;

let parsed;
try {
  parsed = parseArgs({ args, options, allowPositionals: true, strict: false });
} catch (e: any) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}

const { values, positionals } = parsed;

// Handle custom working directory
if (values.cwd) {
  try {
    process.chdir(values.cwd);
  } catch (err: any) {
    console.error(`Error: Could not change directory to "${values.cwd}": ${err.message}`);
    process.exit(1);
  }
}

const command = positionals[0];

if (values.version || (!command && args.includes('-v'))) {
  console.log(version);
  process.exit(0);
}

if (!command || values.help) {
  TUI.banner(undefined, version);
  TUI.info(`Usage: docmd <command> [options]\n`);
  
  TUI.section('Commands');
  const cmds = [
    ['init', 'Initialize a new documentation project'],
    ['build', 'Build the static site for production'],
    ['dev', 'Start the development server'],
    ['live', 'Launch the Live Editor'],
    ['migrate', 'Migrate from Docusaurus, MkDocs, VitePress, etc.'],
    ['deploy', 'Generate production deployment configurations'],
    ['stop', 'Kill all running background docmd dev servers'],
    ['mcp', 'Run docmd as a Model Context Protocol (MCP) server'],
    ['validate', 'Validate documentation files and check for broken relative links'],
    ['add', 'Install and configure a docmd plugin'],
    ['remove', 'Remove and unconfigure a docmd plugin'],
    ['doctor', 'Pre-flight check: report missing plugins, broken configs, mismatched engines (--fix to auto-install)']
  ];
  cmds.forEach(([c, d]) => TUI.item(c, d, TUI.cyan));

  TUI.section('Options');
  const optsList = [
    ['-c, --config', 'Path to config (default: docmd.config.js)'],
    ['-p, --port', 'Port to run server'],
    ['--offline', 'Optimise for file:// viewing'],
    ['--build-only', 'Generate dist/ without starting server'],
    ['-V, --verbose', 'Show detailed package manager logs'],
    ['-v, --version', 'Output the version number'],
    ['-h, --help', 'Display help for command'],
    ['--force', 'Overwrite existing files (use with init)'],
    ['-y, --yes', 'Answer "yes" to all prompts (use with init in CI)']
  ];
  optsList.forEach(([o, d]) => TUI.item(o, d, TUI.cyan));
  
  TUI.section('Deploy Options');
  TUI.item('--docker', 'Generate Dockerfile & .dockerignore', TUI.cyan);
  TUI.item('--nginx', 'Generate production nginx.conf', TUI.cyan);
  TUI.item('--caddy', 'Generate production Caddyfile', TUI.cyan);
  TUI.item('--github-pages', 'Generate GitHub Actions deploy workflow', TUI.cyan);
  TUI.item('--vercel', 'Generate vercel.json', TUI.cyan);
  TUI.item('--netlify', 'Generate netlify.toml', TUI.cyan);
  TUI.footer();
  
  process.exit(0);
}

const opts = {
  config: values.config || 'docmd.config.js',
  offline: values.offline,
  port: values.port,
  buildOnly: values['build-only'],
  verbose: values.verbose,
  force: values.force,
  json: values.json
};

// `--verbose` is a global flag: it must be honoured by every command,
// not just `add` / `remove`. Setting DOCMD_VERBOSE in the process
// environment gives every command (including third-party plugins, the
// TUI, and future commands) a uniform, opt-in way to surface detailed
// logs without having to thread `opts.verbose` through every call site.
// The structured `opts.verbose` is still kept and forwarded to the
// commands that already accept it (installPlugin, removePlugin).
if (opts.verbose) {
  process.env.DOCMD_VERBOSE = 'true';
}

// `mcp` speaks JSON-RPC over stdio: stdout must carry only protocol
// messages, so the banner is skipped there.
if (command !== 'stop' && command !== 'mcp' && !values.json) {
  TUI.banner(undefined, version);
}

if (command === 'init') {
  initProject({ force: values.force, yes: values.yes });
} else if (command === 'build') {
  buildSite(opts.config, { isDev: false, offline: opts.offline, verbose: opts.verbose })
    .then(() => {
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
} else if (command === 'dev') {
  startDevServer(opts.config, opts);
} else if (command === 'live') {
  buildLive({ serve: !opts.buildOnly, verbose: opts.verbose }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else if (command === 'migrate') {
  const migrateArgs = args.slice(args.indexOf('migrate') + 1);
  const migrateOptions = {
    docusaurus: { type: 'boolean' },
    mkdocs: { type: 'boolean' },
    vitepress: { type: 'boolean' },
    starlight: { type: 'boolean' },
    upgrade: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' }
  } as const;

  let migrateParsed;
  try {
    migrateParsed = parseArgs({ args: migrateArgs, options: migrateOptions, allowPositionals: false });
  } catch (e: any) {
    console.log(`\nArgument needed. Please specify a migration source.`);
    console.log(`\nSources:`);
    console.log(`  --docusaurus    Migrate from Docusaurus`);
    console.log(`  --mkdocs        Migrate from MkDocs`);
    console.log(`  --vitepress     Migrate from VitePress`);
    console.log(`  --starlight     Migrate from Astro Starlight`);
    console.log(`  --upgrade       Upgrade legacy docmd configuration to modern schema`);
    process.exit(0);
  }

  const mv = migrateParsed.values;
  if (mv.help) {
    // `--help` is a successful no-op — print help and exit 0.
    console.log(`\nUsage: docmd migrate [options]\n`);
    console.log(`Sources:`);
    console.log(`  --docusaurus    Migrate from Docusaurus`);
    console.log(`  --mkdocs        Migrate from MkDocs`);
    console.log(`  --vitepress     Migrate from VitePress`);
    console.log(`  --starlight     Migrate from Astro Starlight`);
    console.log(`  --upgrade       Upgrade legacy docmd configuration to modern schema`);
    process.exit(0);
  }
  if (!mv.docusaurus && !mv.mkdocs && !mv.vitepress && !mv.starlight && !mv.upgrade) {
    // Phase 3 PR 3.A (F6): `docmd migrate` with no source is a usage error
    // — the user forgot to tell us what to migrate from. Print the same
    // help as `--help` but exit 1 so CI pipelines gate on it.
    console.log(`\nMissing configuration: please specify a migration source.\n`);
    console.log(`Usage: docmd migrate [options]\n`);
    console.log(`Sources:`);
    console.log(`  --docusaurus    Migrate from Docusaurus`);
    console.log(`  --mkdocs        Migrate from MkDocs`);
    console.log(`  --vitepress     Migrate from VitePress`);
    console.log(`  --starlight     Migrate from Astro Starlight`);
    console.log(`  --upgrade       Upgrade legacy docmd configuration to modern schema`);
    process.exit(1);
  }

  migrateProject({
    docusaurus: mv.docusaurus,
    mkdocs: mv.mkdocs,
    vitepress: mv.vitepress,
    starlight: mv.starlight,
    upgrade: mv.upgrade,
    dryRun: mv['dry-run'] === true
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else if (command === 'deploy') {
  // Deploy has its own scoped flags - re-parse argv with deploy-specific options
  const deployArgs = args.slice(args.indexOf('deploy') + 1); // everything after "deploy"
  const deployOptions = {
    docker: { type: 'boolean' },
    nginx: { type: 'boolean' },
    caddy: { type: 'boolean' },
    'github-pages': { type: 'boolean' },
    vercel: { type: 'boolean' },
    netlify: { type: 'boolean' },
    force: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' }
  } as const;

  let deployParsed;
  try {
    deployParsed = parseArgs({ args: deployArgs, options: deployOptions, allowPositionals: false });
  } catch (e: any) {
    console.log(`\nArgument needed. Please specify a deployment target.`);
    process.exit(0);
  }

  const dv = deployParsed.values;

  if (dv.help) {
    console.log(`\nUsage: docmd deploy [options]\n`);
    console.log(`Self-hosted:`);
    console.log(`  --docker          Generate Dockerfile & .dockerignore`);
    console.log(`  --nginx           Generate production nginx.conf`);
    console.log(`  --caddy           Generate production Caddyfile`);
    console.log(`\nCloud / CI:`);
    console.log(`  --github-pages    Generate GitHub Actions deploy workflow`);
    console.log(`  --vercel          Generate vercel.json`);
    console.log(`  --netlify         Generate netlify.toml`);
    console.log(`\nOptions:`);
    console.log(`  --force           Overwrite existing deployment files`);
    console.log(`  -h, --help        Show this help message`);
    process.exit(0);
  }

  initDeploy({
    docker: dv.docker,
    nginx: dv.nginx,
    caddy: dv.caddy,
    githubPages: dv['github-pages'],
    vercel: dv.vercel,
    netlify: dv.netlify,
    force: dv.force,
    config: opts.config
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else if (command === 'stop') {
  stopServer(opts.port, opts.force);
} else if (command === 'add') {
  if (!positionals[1]) {
    console.error('Error: missing plugin name.');
    process.exit(1);
  }
  installPlugin(positionals[1], opts);
} else if (command === 'remove') {
  if (!positionals[1]) {
    console.error('Error: missing plugin name.');
    process.exit(1);
  }
  removePlugin(positionals[1], opts);
} else if (command === 'doctor') {
  const { runDoctor } = await import('../commands/doctor.js');
  const fix = values.fix === true;
  const asJson = values.json === true;
  const configPath = typeof values.config === 'string' ? values.config : undefined;
  const code = await runDoctor({ configPath, fix, json: asJson });
  if (code !== 0) process.exit(code);
} else if (command === 'mcp') {
  runMcpServer().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else if (command === 'validate') {
  validateProject({ json: opts.json }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  console.error(`Unknown command: ${command}`);
  console.log(`\nRun 'docmd --help' for the list of available commands.\n`);
  process.exit(1);
}