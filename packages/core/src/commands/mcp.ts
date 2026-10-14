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

import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { buildSite } from './build.js';
import { loadConfig } from '../utils/config-loader.js';
import { safePath, asUserPath } from '@docmd/utils';
import { findFilesRecursive } from '../engine/assets.js';

const pkgUrl = new URL('../../package.json', import.meta.url);
const { version } = JSON.parse(fs.readFileSync(pkgUrl, 'utf-8'));

// Helpers to find and search markdown files
// excludePatterns / projectRoot mirror the build-side semantics from config.exclude
// (gitignore-style globs). The same patterns are passed to findFilesRecursive,
// which already implements the full matching logic used by generator.ts and i18n.ts.
function findMarkdownFiles(dir: string, excludePatterns: string[] = [], projectRoot?: string): string[] {
  const results: string[] = [];
  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);

      if (stat && stat.isDirectory()) {
        if (file === 'node_modules' || file.startsWith('.')) continue;

        // Apply exclude patterns to directories so we can prune whole subtrees
        if (excludePatterns.length > 0 && isExcludedByPatterns(fullPath, file, excludePatterns, projectRoot)) continue;

        results.push(...findMarkdownFiles(fullPath, excludePatterns, projectRoot));
      } else if (file.endsWith('.md') || file.endsWith('.markdown')) {
        // Apply exclude patterns to individual files
        if (excludePatterns.length > 0 && isExcludedByPatterns(fullPath, file, excludePatterns, projectRoot)) continue;

        results.push(fullPath);
      }
    }
  } catch { /* ignore filesystem errors */ }
  return results;
}

/** Escape special regex characters — used by isExcludedByPatterns. */
function escapeRegex(s: string): string {
  return s.replace(/[-+^$.|?*(){}[\]\\]/g, (ch) => `\\${ch}`);
}

/**
 * Lightweight gitignore-style glob check that matches the build-side semantics
 * from assets.ts isExcludedPath(). Supports exact name matches, suffix/prefix
 * wildcards, `**` / `*` glob patterns, and anchored patterns (leading `/`).
 */
function isExcludedByPatterns(fullPath: string, name: string, patterns: string[], projectRoot?: string): boolean {
  if (patterns.length === 0) return false;
  const normalizedPath = fullPath.replace(/\\/g, '/');
  const normalizedRoot = projectRoot ? path.resolve(projectRoot).replace(/\\/g, '/') : null;

  for (const pat of patterns) {
    const isAnchored = pat.startsWith('/');
    let start = 0;
    let end = pat.length;
    while (start < end && pat.charCodeAt(start) === 47) start++;
    while (end > start && pat.charCodeAt(end - 1) === 47) end--;
    const cleanPat = pat.slice(start, end);
    if (!cleanPat) continue;

    if (isAnchored && normalizedRoot) {
      const relPath = normalizedPath.startsWith(normalizedRoot + '/')
        ? normalizedPath.slice(normalizedRoot.length + 1)
        : null;
      if (!relPath) continue;
      if (relPath === cleanPat || relPath.startsWith(cleanPat + '/')) return true;
      if (cleanPat.includes('*')) {
        try {
          const regexStr = escapeRegex(cleanPat).replace(/\.\*\./g, '.*').replace(/\*\*/g, '.*').replace(/(?<!\.)\*/g, '[^/]*');
          const re = new RegExp(`^${regexStr}(/|$)`);
          if (re.test(relPath)) return true;
        } catch { /* ignore */ }
      }
      continue;
    }

    if (name === cleanPat) return true;
    if (cleanPat.startsWith('*.') && name.endsWith(cleanPat.slice(1))) return true;
    if (cleanPat.endsWith('*') && !cleanPat.includes('/') && name.startsWith(cleanPat.slice(0, -1))) return true;
    if (normalizedPath.includes(`/${cleanPat}/`) || normalizedPath.endsWith(`/${cleanPat}`)) return true;

    if (cleanPat.includes('*')) {
      try {
        const regexStr = escapeRegex(cleanPat).replace(/\.\*\./g, '.*').replace(/\*\*/g, '.*').replace(/(?<!\.)\*/g, '[^/]*');
        const re = new RegExp(`(^|/)${regexStr}(/|$)`);
        if (re.test(normalizedPath) || re.test(name)) return true;
      } catch { /* ignore */ }
    }
  }
  return false;
}

// excludePatterns is forwarded from config.exclude so that validate_docs
// honours the same file set that the build produces. Fixes #245.
export function validateLinks(docsDir: string, excludePatterns: string[] = []): { file: string; line: number; link: string; error: string }[] {
  const errors: { file: string; line: number; link: string; error: string }[] = [];
  if (!fs.existsSync(docsDir)) return errors;

  const mdFiles = findMarkdownFiles(docsDir, excludePatterns, docsDir);

  for (const filePath of mdFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      const relativeFile = path.relative(process.cwd(), filePath);

      let inFence = false;
      let fenceChar = '';
      let fenceLength = 0;

      lines.forEach((lineText, lineIdx) => {
        const lineNum = lineIdx + 1;
        const trimmedLeading = lineText.trimStart();

        // Fix #259: skip lines inside fenced code blocks (``` or ~~~).
        // Fences allow up to 3 spaces of indentation.
        const indentLength = lineText.length - trimmedLeading.length;
        if (indentLength <= 3) {
          if (inFence) {
            const closeRegex = new RegExp(`^${fenceChar === '`' ? '`' : '~'}{${fenceLength},}\\s*$`);
            if (closeRegex.test(trimmedLeading)) {
              inFence = false;
              fenceChar = '';
              fenceLength = 0;
            }
            return;
          }

          const openMatch = trimmedLeading.match(/^(`{3,}|~{3,})/);
          if (openMatch) {
            inFence = true;
            fenceChar = openMatch[1][0];
            fenceLength = openMatch[1].length;
            return;
          }
        } else if (inFence) {
          return;
        }

        // Fix #251: the link text may be empty (`[](./image.jpg)`), so it is
        // matched with `*`; requiring `+` silently skipped those links.
        const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
        let match;
        while ((match = linkRegex.exec(lineText)) !== null) {
          let rawTarget = match[2].trim();

          // Fix #259: strip optional markdown link title and angle brackets
          // e.g. `[text](guides/install.md "Install docmd")` or `[text](<guides/install.md> "Install")`
          if (rawTarget.startsWith('<')) {
            const closeIdx = rawTarget.indexOf('>');
            if (closeIdx !== -1) {
              rawTarget = rawTarget.slice(1, closeIdx);
            }
          } else {
            const spaceIdx = rawTarget.search(/\s/);
            if (spaceIdx !== -1) {
              rawTarget = rawTarget.slice(0, spaceIdx);
            }
          }

          const linkTarget = rawTarget.trim().split('#')[0]; // strip anchors
          if (!linkTarget) continue;

          // Skip external, anchors, mailto, etc.
          if (
            linkTarget.startsWith('http://') ||
            linkTarget.startsWith('https://') ||
            linkTarget.startsWith('mailto:') ||
            linkTarget.startsWith('tel:') ||
            linkTarget.startsWith('#')
          ) {
            continue;
          }

          // Resolve link relative to file's directory
          let resolvedPath = '';
          if (linkTarget.startsWith('/')) {
            resolvedPath = path.join(docsDir, linkTarget);
          } else {
            resolvedPath = path.resolve(path.dirname(filePath), linkTarget);
          }

          // Phase 3 PR 3.C (M-1): strip trailing slash before the
          // `.md` / `.markdown` / `index.*` existence checks. Most
          // markdown editors add a trailing slash to internal links
          // (e.g. `[page 2](/page-2/)`), and the previous code did
          // `fs.existsSync('docs/page-2/.md')` which is always false.
          // The build itself produces `page-2/index.html` and treats
          // the trailing-slash and no-slash forms as the same link,
          // so the validator MUST agree or it false-positives every
          // valid link.
          const stripped = resolvedPath.endsWith('/') && resolvedPath.length > 1
            ? resolvedPath.slice(0, -1)
            : resolvedPath;

          // Fix #250: the build copies the project-root `assets/` directory
          // to `/assets/` in the site (engine/assets.ts), so an absolute
          // `/assets/...` link is also valid when the file exists there.
          const existsInRootAssets =
            /^\/assets\//.test(linkTarget) &&
            fs.existsSync(path.join(process.cwd(), linkTarget));

          const exists =
            existsInRootAssets ||
            fs.existsSync(stripped) ||
            fs.existsSync(stripped + '.md') ||
            fs.existsSync(stripped + '.markdown') ||
            fs.existsSync(path.join(stripped, 'index.md')) ||
            fs.existsSync(path.join(stripped, 'index.markdown'));

          if (!exists) {
            errors.push({
              file: relativeFile,
              line: lineNum,
              link: linkTarget,
              error: `Broken link: target resolved to ${path.relative(process.cwd(), resolvedPath)} does not exist`
            });
          }
        }
      });
    } catch { /* ignore read errors */ }
  }

  return errors;
}

export async function runMcpServer() {
  console.error("docmd MCP server starting...");

  const rl = readline.createInterface({
    input: process.stdin,
    output: undefined,
    terminal: false
  });

  const sendResponse = (id: any, result: any) => {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  };

  const sendError = (id: any, code: number, message: string, data?: any) => {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message, data } }) + "\n");
  };

  rl.on('line', async (line) => {
    if (!line.trim()) return;
    try {
      const message = JSON.parse(line);
      if (message.jsonrpc !== "2.0") {
        sendError(message.id || null, -32600, "Invalid Request");
        return;
      }

      const { method, params, id } = message;

      if (method === "initialize") {
        sendResponse(id, {
          protocolVersion: "2025-03-26",
          capabilities: {
            resources: {},
            tools: {},
            prompts: {}
          },
          serverInfo: {
            name: "docmd-mcp-server",
            version
          }
        });
        return;
      }

      if (method === "notifications/initialized" || method === "initialized") {
        // Notification, no response needed
        return;
      }

      if (method === "ping") {
        sendResponse(id, {});
        return;
      }

      // Handle Prompts Listing
      // The prompts capability is declared in initialize for forward
      // compatibility. docmd ships no built-in prompts yet, so return an
      // empty list rather than leaving the client to hit an unhandled-method error.
      if (method === "prompts/list") {
        sendResponse(id, { prompts: [] });
        return;
      }

      // Handle Tools Listing
      if (method === "tools/list") {
        sendResponse(id, {
          tools: [
            {
              name: "search_docs",
              description: "Search the documentation content for a specific query.",
              inputSchema: {
                type: "object",
                properties: {
                  query: { type: "string", description: "The term or phrase to search for." }
                },
                required: ["query"]
              }
            },
            {
              name: "list_docs",
              description: "List all documentation files in the project. Returns relative paths so the agent can navigate the docs structure before reading individual files.",
              inputSchema: {
                type: "object",
                properties: {
                  subdir: { type: "string", "description": "Optional subdirectory to scope the listing (e.g. 'en', 'v1', 'guides'). Defaults to the configured source directory root." }
                }
              }
            },
            {
              name: "read_doc",
              description: "Read the raw markdown content of a documentation file.",
              inputSchema: {
                type: "object",
                properties: {
                  route: { type: "string", description: "Relative path to the markdown file from root (e.g. docs/getting-started.md)." }
                },
                required: ["route"]
              }
            },
            {
              name: "get_config",
              description: "Retrieve the resolved docmd project configuration (docmd.config.json). Exposes the source directory, output directory, configured locales, versions, and enabled plugins so the agent understands the project structure.",
              inputSchema: {
                type: "object",
                properties: {}
              }
            },
            {
              name: "validate_docs",
              description: "Validates and lints all local markdown links to detect broken paths.",
              inputSchema: {
                type: "object",
                properties: {}
              }
            },
            {
              name: "get_llms_context",
              description: "Retrieve the unified prompt context of the entire documentation site (llms.txt content).",
              inputSchema: {
                type: "object",
                properties: {}
              }
            }
          ]
        });
        return;
      }

      // Handle Resources Listing
      if (method === "resources/list") {
        sendResponse(id, {
          resources: [
            {
              uri: "docmd://context/llms.txt",
              name: "llms.txt Context",
              mimeType: "text/plain",
              description: "Unified text context containing the entire documentation site"
            },
            {
              uri: "docmd://context/skill",
              name: "Agent SKILL.md",
              mimeType: "text/markdown",
              description: "Instruction manual and skills reference for docmd"
            }
          ]
        });
        return;
      }

      // Handle Resources Read
      if (method === "resources/read") {
        const { uri } = params || {};
        if (!uri) {
          sendResponse(id, { content: [{ type: "text", text: "Error: URI parameter is required." }] });
          return;
        }

        let config: any;
        try {
          config = await loadConfig('docmd.config.js', { quiet: true });
        } catch {
          config = { src: 'docs', out: 'site' };
        }

        if (uri === "docmd://context/llms.txt") {
          const llmsFullFile = path.resolve(process.cwd(), config.out || 'site', 'llms-full.txt');
          if (fs.existsSync(llmsFullFile)) {
            try {
              const fullContext = fs.readFileSync(llmsFullFile, 'utf8');
              sendResponse(id, {
                contents: [{
                  uri,
                  mimeType: "text/plain",
                  text: fullContext
                }]
              });
            } catch (err: any) {
              sendResponse(id, { content: [{ type: "text", text: `Error reading context file: ${err.message}` }] });
            }
          } else {
            sendResponse(id, { content: [{ type: "text", text: "Error: llms-full.txt context file has not been generated." }] });
          }
          return;
        }

        if (uri === "docmd://context/skill") {
          const skillFile = path.resolve(process.cwd(), 'SKILL.md');
          let content = '';
          if (fs.existsSync(skillFile)) {
            try {
              content = fs.readFileSync(skillFile, 'utf8');
            } catch (err: any) {
              sendResponse(id, { content: [{ type: "text", text: `Error reading SKILL.md: ${err.message}` }] });
              return;
            }
          } else {
            content = [
              "---",
              "name: docmd",
              "description: Fallback agent instruction set for docmd.",
              "skills: docmd-skills (npm)",
              "docs: https://docs.docmd.io",
              "llms-context: https://docs.docmd.io/llms-full.txt",
              "---",
              "",
              "# docmd Agent Skills",
              "",
              "This project uses **docmd**, the zero-config AI-first documentation engine.",
              "",
              "## Get the full skill set (single-line install)",
              "",
              "Run this once per machine to install the full agent skill set into your agent's skills directory:",
              "",
              "```bash",
              "npx docmd-skills ~/.claude/skills",
              "```",
              "",
              "Replace `~/.claude/skills` with the directory your agent reads skills from: `~/.cursor/skills` (Cursor), `./.skills` (project-local), etc. Run `npx docmd-skills --help` for the full subcommand list. The single install command pulls in the `docmd-skills`, `docmd-dev`, and `docmd-writer` skill modules — see https://github.com/docmd-io/docmd-skills for details.",
              "",
              "## Project-local override",
              "This fallback content covers the general case. For project-specific instructions, create a `SKILL.md` at the root of the docmd project — the `docmd://context/skill` MCP resource returns that local file in preference to this fallback."
            ].join('\n');
          }

          sendResponse(id, {
            contents: [{
              uri,
              mimeType: "text/markdown",
              text: content
            }]
          });
          return;
        }

        sendError(id, -32602, `Resource not found: ${uri}`);
        return;
      }

      // Handle Tools Execution
      if (method === "tools/call") {
        const { name, arguments: args } = params;

        // Resolve workspace parameters
        let config: any;
        try {
          config = await loadConfig('docmd.config.js', { quiet: true });
        } catch {
          // Fallback zero config
          config = { src: 'docs', out: 'site' };
        }
        const docsDir = path.resolve(process.cwd(), config.src || 'docs');

        if (name === "search_docs") {
          const query = (args?.query || "").toLowerCase();
          if (!query) {
            sendResponse(id, { content: [{ type: "text", text: "Error: Query parameter is required." }] });
            return;
          }

          if (!fs.existsSync(docsDir)) {
            sendResponse(id, { content: [{ type: "text", text: `Error: Source directory "${docsDir}" does not exist.` }] });
            return;
          }

          // Fix #245: use findFilesRecursive so that config.exclude is honoured
          const mdFiles = await findFilesRecursive(docsDir, ['.md', '.markdown'], config.exclude || []);
          const matches: string[] = [];

          for (const filePath of mdFiles) {
            try {
              const fileContent = fs.readFileSync(filePath, 'utf8');
              const lines = fileContent.split('\n');
              const fileRelPath = path.relative(process.cwd(), filePath);
              let foundInFile = false;

              lines.forEach((lineText, idx) => {
                if (lineText.toLowerCase().includes(query)) {
                  if (!foundInFile) {
                    matches.push(`\n### File: ${fileRelPath}`);
                    foundInFile = true;
                  }
                  matches.push(`Line ${idx + 1}: ${lineText.trim()}`);
                }
              });
            } catch { /* ignore file errors */ }
          }

          const textResult = matches.length > 0 
            ? `Found search matches:\n${matches.join('\n')}`
            : `No matches found for query: "${query}"`;

          sendResponse(id, { content: [{ type: "text", text: textResult }] });
          return;
        }

        if (name === "list_docs") {
          const subdir = (args?.subdir || "").trim();
          let listRoot = docsDir;
          if (subdir) {
            // CWE-22 guard: same safePath treatment as read_doc.
            if (path.isAbsolute(subdir)) {
              sendResponse(id, { content: [{ type: "text", text: `Error: Absolute paths are not allowed.` }] });
              return;
            }
            try {
              listRoot = safePath(docsDir, asUserPath(subdir));
            } catch {
              sendResponse(id, { content: [{ type: "text", text: `Error: Path "${subdir}" escapes the source directory.` }] });
              return;
            }
          }
          if (!fs.existsSync(listRoot)) {
            sendResponse(id, { content: [{ type: "text", text: `Error: Directory "${path.relative(process.cwd(), listRoot)}" does not exist.` }] });
            return;
          }
          // Fix #245: use findFilesRecursive so that config.exclude is honoured
          const files = (await findFilesRecursive(listRoot, ['.md', '.markdown'], config.exclude || [])).map(f => path.relative(process.cwd(), f));
          const sorted = files.sort();
          const textResult = sorted.length > 0
            ? `Documentation files (${sorted.length}):\n${sorted.join('\n')}`
            : `No markdown files found under "${path.relative(process.cwd(), listRoot)}".`;
          sendResponse(id, { content: [{ type: "text", text: textResult }] });
          return;
        }

        if (name === "get_config") {
          try {
            const resolvedConfig = await loadConfig('docmd.config.js', { quiet: true });
            // Surface only the structural keys an agent needs. Omit
            // potentially sensitive values (API keys, analytics IDs) by
            // reconstructing a safe summary from the resolved config.
            const safeSummary: Record<string, any> = {
              title: resolvedConfig.title || 'Untitled',
              src: resolvedConfig.src || 'docs',
              out: resolvedConfig.out || 'site',
              url: resolvedConfig.url || null,
              theme: resolvedConfig.theme?.name || 'default',
              i18n: resolvedConfig.i18n
                ? {
                    default: resolvedConfig.i18n.default,
                    locales: (resolvedConfig.i18n.locales || []).map((l: any) => ({ id: l.id, label: l.label, dir: l.dir }))
                  }
                : null,
              versions: resolvedConfig.versions
                ? {
                    current: resolvedConfig.versions.current,
                    all: (resolvedConfig.versions.all || []).map((v: any) => ({ id: v.id, dir: v.dir, label: v.label }))
                  }
                : null,
              plugins: resolvedConfig.plugins
                ? Object.keys(resolvedConfig.plugins).map(k => ({
                    name: k,
                    enabled: resolvedConfig.plugins[k] !== false
                  }))
                : []
            };
            sendResponse(id, { content: [{ type: "text", text: JSON.stringify(safeSummary, null, 2) }] });
          } catch (err: any) {
            sendResponse(id, { content: [{ type: "text", text: `Error loading config: ${err.message}\n\nThe project may be running in zero-config mode (source: ./docs, output: ./site).` }] });
          }
          return;
        }

        if (name === "read_doc") {
          const route = args?.route || "";
          if (!route) {
            sendResponse(id, { content: [{ type: "text", text: "Error: Route is required." }] });
            return;
          }
          // Phase 1.A: CWE-22 fix (S-3, T-S1). Reject absolute paths outright and
          // require relative paths to resolve inside the project root (cwd) via safePath().
          // Preserves the pre-fix semantic where route was resolved against process.cwd().
          if (path.isAbsolute(route)) {
            sendResponse(id, { content: [{ type: "text", text: `Error: Absolute paths are not allowed.` }] });
            return;
          }
          let resolvedFilePath: string;
          try {
            resolvedFilePath = safePath(process.cwd(), asUserPath(route));
          } catch (_e: any) {
            sendResponse(id, { content: [{ type: "text", text: `Error: Path "${route}" escapes project root.` }] });
            return;
          }
          if (!fs.existsSync(resolvedFilePath)) {
            sendResponse(id, { content: [{ type: "text", text: `Error: File not found at path "${route}".` }] });
            return;
          }

          try {
            const rawContent = fs.readFileSync(resolvedFilePath, 'utf8');
            sendResponse(id, { content: [{ type: "text", text: rawContent }] });
          } catch (err: any) {
            sendResponse(id, { content: [{ type: "text", text: `Error reading file: ${err.message}` }] });
          }
          return;
        }

        if (name === "validate_docs") {
          // Fix #245: pass config.exclude so validate_docs agrees with the build
          const errors = validateLinks(docsDir, config.exclude || []);
          if (errors.length === 0) {
            sendResponse(id, { content: [{ type: "text", text: "Documentation links validated successfully! No broken links found." }] });
          } else {
            const errorReport = errors.map(e => `[${e.file}:${e.line}] -> ${e.link} (${e.error})`).join('\n');
            sendResponse(id, { content: [{ type: "text", text: `Validation errors found:\n${errorReport}` }] });
          }
          return;
        }

        if (name === "get_llms_context") {
          // Trigger build to ensure context is up to date
          try {
            console.error("Building site context...");
            await buildSite('docmd.config.js', { quiet: true, isDev: false });
          } catch (err: any) {
            console.error(`Build warning: ${err.message}`);
          }

          const llmsFullFile = path.resolve(process.cwd(), config.out || 'site', 'llms-full.txt');
          if (fs.existsSync(llmsFullFile)) {
            try {
              const fullContext = fs.readFileSync(llmsFullFile, 'utf8');
              sendResponse(id, { content: [{ type: "text", text: fullContext }] });
            } catch (err: any) {
              sendResponse(id, { content: [{ type: "text", text: `Error reading context file: ${err.message}` }] });
            }
          } else {
            sendResponse(id, { content: [{ type: "text", text: "Error: llms-full.txt context file has not been generated. Please make sure the build finishes successfully." }] });
          }
          return;
        }

        sendError(id, -32601, `Method not found: ${name}`);
        return;
      }

      sendError(id, -32601, `Method not found: ${method}`);
    } catch (err: any) {
      sendError(null, -32700, `Parse error: ${err.message}`);
    }
  });
}