/**
 * Starts the e2e site on the workspace build of docmd, with the threads plugin enabled.
 * The site lives in $THREADS_E2E_SITE, a temp dir set by playwright.config.ts: two pages
 * (index, seeded from `fixtures/playground-index.md`, which the specs expect to carry its
 * threads and rewrite as they run, and links to the linked page; linked, seeded from
 * `fixtures/linked-page.md`) and a docmd.config.json. It stays out of the repo because docmd skips
 * gitignored sources and plugin actions only write inside the project root.
 * Run by playwright.config.ts as its webServer; port is the first CLI argument. THREADS_E2E_TEMPLATE and
 * THREADS_E2E_THEME (the visual project's servers) pick a template and a colour theme for the site.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { safePath } from "@docmd/utils";

const here = path.dirname(fileURLToPath(import.meta.url));
const docmd = path.resolve(here, "../../../core/dist/bin/docmd.js");
const site = process.env["THREADS_E2E_SITE"];
const port = process.argv[2] ?? "4175";

if (!site) {
  console.error("e2e: THREADS_E2E_SITE is unset (set by playwright.config.ts)");
  process.exit(1);
}
if (!fs.existsSync(docmd)) {
  console.error(`e2e: ${docmd} not found: run \`pnpm -r run build\` first`);
  process.exit(1);
}

fs.rmSync(site, { recursive: true, force: true });
fs.mkdirSync(safePath(site, "docs"), { recursive: true });
fs.copyFileSync(path.join(here, "fixtures/playground-index.md"), safePath(site, "docs/index.md"));
fs.copyFileSync(path.join(here, "fixtures/linked-page.md"), safePath(site, "docs/linked.md"));
const config = { title: "threads e2e", src: "docs", out: "site", plugins: { threads: {} } };
// The visual project (see playwright.config.ts) serves the site once per look: a template and/or a colour theme.
// Both are unset for the default specs, which run on the default template with no theme.
const template = process.env["THREADS_E2E_TEMPLATE"];
const theme = process.env["THREADS_E2E_THEME"];
if (template || theme) {
  config.theme = {};
  if (template) config.theme.template = template;
  if (theme) config.theme.name = theme;
}
fs.writeFileSync(safePath(site, "docmd.config.json"), JSON.stringify(config, null, 2));

// DOCMD_TEST, the repo's test mode, makes docmd load the workspace plugins from outside the
// repo instead of installing the published ones (and not open a browser).
const child = spawn(process.execPath, [docmd, "dev", "--port", port], {
  cwd: site,
  env: { ...process.env, DOCMD_TEST: "true" },
  stdio: "inherit",
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
