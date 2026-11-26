/**
 * Helpers for seeding and cleaning threads in E2E tests.
 *
 * Unlike the old HTTP API-based approach, we use docmd.call() via
 * page.evaluate() to interact with the WebSocket action dispatcher.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { safePath } from "@docmd/utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** The index.md the dev server serves; serve-playground.mjs seeds it from the fixture. */
const site = process.env["THREADS_E2E_SITE"];
if (!site) throw new Error("e2e: THREADS_E2E_SITE is unset (run the suite with `pnpm test:e2e`)");
const PLAYGROUND_INDEX = path.join(site, "docs/index.md");

/** The callers' draft journals (see src/plugin/drafts.ts); they outlive a restore of the markdown. */
const DRAFTS_DIR = path.join(site, "docs/.threads/drafts");

/** Path to the fixture copy of the original playground markdown. */
const FIXTURE_INDEX = path.resolve(__dirname, "fixtures/playground-index.md");

/**
 * The page's `<main>`, which holds every thread, comment and highlight. The rest of the page carries
 * per-build stamps (asset `?v=` and build time), so a rebuild of the same markdown changes it.
 */
export function mainOf(html: string): string {
  const main = html.match(/<main[\s\S]*?<\/main>/);
  if (!main) throw new Error("e2e: served page has no <main>");
  return main[0];
}

/**
 * Restore the playground markdown to its fixture state, removing any dynamically-added
 * threads/highlights from test runs, drop every caller's unpublished drafts (they would
 * otherwise show up in the next test's view and ride into its publish), and wait until
 * the dev server serves the clean page
 * (global-setup.ts recorded its `<main>`), so no rebuild of the restore lands in the test.
 *
 * Until `docmd dev` stops dropping saves made within 1 s of a rebuild finishing, a restore
 * can be missed: it is rewritten until served. At most 3 attempts x 4 s keeps the worst
 * case under the 30 s hook timeout.
 */
export async function cleanThreads(page: Page): Promise<void> {
  const clean = process.env["THREADS_E2E_CLEAN_MAIN"];
  if (!clean) throw new Error("e2e: THREADS_E2E_CLEAN_MAIN is unset (global-setup did not run)");
  const fixtureContent = fs.readFileSync(FIXTURE_INDEX, "utf-8");
  const served = async () => mainOf(await (await page.request.get("/")).text()) === clean;
  fs.rmSync(DRAFTS_DIR, { recursive: true, force: true });
  for (let attempt = 1; ; attempt++) {
    fs.writeFileSync(PLAYGROUND_INDEX, fixtureContent, "utf-8");
    try {
      await expect.poll(served, { message: "dev server rebuild of / after restoring it", timeout: 4_000 }).toBe(true);
      return;
    } catch (e) {
      if (attempt === 3) throw e;
    }
  }
}

/** The `<main>` the dev server serves for the page open in `page`. */
async function servedMain(page: Page): Promise<string> {
  return mainOf(await (await page.request.get(new URL(page.url()).pathname)).text());
}

/**
 * Publish the open review of the caller `author` (`authorKey` defaults to the name, as the
 * server does when a call sends none). Mutations only write the caller's draft journal;
 * publishing writes them into the markdown. Resolves once the dev server serves the rebuilt
 * page, so a reload right after sees the published threads.
 */
export async function publishReview(
  page: Page,
  author = "TestUser",
  authorKey?: string,
): Promise<{ reviewId: string }> {
  const before = await servedMain(page);
  const result = await page.evaluate(
    ({ author, authorKey }) =>
      docmd.call("threads:publish-review", authorKey ? { author, authorKey } : { author }),
    { author, authorKey },
  );
  await expect
    .poll(() => servedMain(page), { message: "dev server rebuild of the page after publishing", timeout: 5_000 })
    .not.toBe(before);
  return result;
}

/**
 * The author key the client stored after a UI action (it derives one from the name on the
 * first comment). Drafts made through the UI live in the journal of this key.
 */
export async function clientKey(page: Page): Promise<string> {
  const key = await page.evaluate(() => localStorage.getItem("threads_author_key"));
  if (!key) throw new Error("e2e: the client has not stored an author key yet (comment through the UI first)");
  return key;
}

/**
 * Seed a thread via the WebSocket action dispatcher.
 * Must be called after the page is loaded and docmd global is available.
 *
 * Each step is published (as its author), so the thread is in the markdown and the
 * server renders it. Each publish writes to the markdown file, which may trigger the
 * dev server's file watcher to hot-reload the page. To avoid execution
 * context destruction, we split multi-step operations (add-thread +
 * add-comment replies) across separate page.evaluate() calls with page
 * reloads in between.
 */
export async function seedThread(
  page: Page,
  options: {
    author?: string;
    body?: string;
    anchor?: { quote: string } | null;
    replies?: Array<{ author?: string; body: string }>;
    resolved?: boolean;
  } = {},
): Promise<{ id: string; comments: Array<{ id: string }> }> {
  const {
    author = "TestUser",
    body = "Seeded comment",
    anchor = null,
    replies = [],
    resolved = false,
  } = options;

  // Step 1: Create the thread with its first comment
  const thread = await page.evaluate(
    async ({ author, body, anchor }) => {
      const file = document.body.dataset["sourceFile"];
      if (!file) throw new Error("data-source-file not found on body");

      return docmd.call("threads:add-thread", {
        file,
        author,
        body,
        anchor: anchor
          ? {
              quote: anchor.quote,
              prefix: null,
              suffix: null,
              selector: null,
              offset: null,
              blockText: null,
            }
          : null,
      });
    },
    { author, body, anchor },
  );
  await publishReview(page, author);

  const commentIds = [thread.comments[0].id];

  // Step 2: Add replies one at a time, reloading the page between each
  // to avoid execution context destruction from hot-reload
  for (const reply of replies) {
    await page.waitForTimeout(500);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("threads-app", { state: "attached", timeout: 10_000 });

    const comment = await page.evaluate(
      async ({ file, threadId, replyAuthor, replyBody }) => {
        const f = file || document.body.dataset["sourceFile"];
        return docmd.call("threads:add-comment", {
          file: f,
          threadId,
          author: replyAuthor,
          body: replyBody,
        });
      },
      {
        file: null as string | null,
        threadId: thread.id,
        replyAuthor: reply.author ?? "TestUser",
        replyBody: reply.body,
      },
    );
    commentIds.push(comment.id);
    await publishReview(page, reply.author ?? "TestUser");
  }

  // Step 3: Resolve if requested
  if (resolved) {
    // Always reload before resolving to ensure the DOM is fresh after the last write
    // and avoid execution context destruction during the resolve-thread call.
    await page.waitForTimeout(500);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("threads-app", { state: "attached", timeout: 10_000 });

    await page.evaluate(
      async ({ threadId, resolvedBy }) => {
        const file = document.body.dataset["sourceFile"];
        return docmd.call("threads:resolve-thread", {
          file,
          threadId,
          author: resolvedBy,
          resolved_by: resolvedBy,
        });
      },
      { threadId: thread.id, resolvedBy: author },
    );
    await publishReview(page, author);
  }

  return {
    id: thread.id,
    comments: commentIds.map((id) => ({ id })),
  };
}

/**
 * Reload the page and wait for the threads-app element to re-attach.
 * After seeding/cleaning threads via WebSocket actions, the markdown file
 * on disk has changed. Give the dev server a moment to detect the change,
 * then reload.
 */
export async function waitForReload(page: Page): Promise<void> {
  await page.waitForTimeout(2000);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("threads-app", { state: "attached", timeout: 10_000 });
}

/**
 * Seed a thread, reload the page, and wait until the thread element appears
 * in the server-rendered HTML.
 */
export async function seedAndReload(
  page: Page,
  options: Parameters<typeof seedThread>[1] = {},
): Promise<{ id: string; comments: Array<{ id: string }> }> {
  const result = await seedThread(page, options);

  // The seed action writes to the markdown file. The dev server needs time
  // to detect the change and re-render. Retry the reload until the thread
  // appears in the server-rendered HTML (up to 3 attempts).
  const selector = `.threads-thread[data-thread-id="${result.id}"]`;
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.waitForTimeout(attempt === 0 ? 500 : 1500);
    await page.goto(page.url(), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("threads-app", { state: "attached", timeout: 10_000 });

    const found = await page.locator(selector).count();
    if (found > 0) return result;
  }

  // Final attempt - let Playwright's own timeout handle it
  await page.waitForSelector(selector, { state: "attached", timeout: 5_000 });

  return result;
}

/**
 * Set the author identity in localStorage.
 */
export async function setAuthor(page: Page, name: string): Promise<void> {
  await page.evaluate(
    (authorName) => localStorage.setItem("threads_author", authorName),
    name,
  );
}

/**
 * Wait for the client-side threads-app to finish processing:
 * scanRenderedHighlights assigns color classes, moves thread cards inline, etc.
 * We detect completion by waiting for the first highlight to receive a color class.
 */
export async function waitForClientProcessing(page: Page): Promise<void> {
  const hasHighlights = await page.locator("mark.threads-highlight[data-thread-id]").count();
  if (hasHighlights > 0) {
    // Wait for the first highlight to get a color class (assigned by scanRenderedHighlights)
    await page.waitForFunction(
      () => {
        const mark = document.querySelector("mark.threads-highlight[data-thread-id]");
        if (!mark) return true; // No highlights, nothing to wait for
        return Array.from(mark.classList).some((c) => c.startsWith("threads-hl-"));
      },
      { timeout: 5_000 },
    );
  } else {
    // No highlights on page, just wait a moment for client JS to initialize
    await page.waitForTimeout(500);
  }
}
const SITE_ROOT: string = site;
const THREADS_DIR = safePath(SITE_ROOT, "docs/.threads");
const AUTHORS_FILE = safePath(SITE_ROOT, "docs/.threads/authors.json");
const TEST_IDENTITY = { author: "TestUser", authorKey: "testuser" };

/**
 * The dev server reloads the page when the author profile file changes, which the first draft of a server's life
 * does (it creates the file). Create it up front and wait for that rebuild, so no reload lands in the middle of a
 * test. Returns whether this call created it: the caller removes it again with `removeAuthorProfile`.
 */
export async function ensureAuthorProfile(page: Page): Promise<boolean> {
  if (fs.existsSync(AUTHORS_FILE)) return false;
  const before = await (await page.request.get("/")).text();
  fs.mkdirSync(THREADS_DIR, { recursive: true });
  fs.writeFileSync(AUTHORS_FILE, JSON.stringify({ testuser: { name: "TestUser", avatarUrl: "" } }, null, 2) + "\n");
  await expect.poll(async () => (await page.request.get("/")).text(), { message: "dev server rebuild after the profile file" }).not.toBe(before);
  return true;
}

/** Remove the profile file `ensureAuthorProfile` created. */
export function removeAuthorProfile(): void {
  fs.rmSync(AUTHORS_FILE, { force: true });
}

/**
 * Empty the caller's open review, so a test starts from (and leaves) a journal with no ops. A dev-server reload can
 * tear the page down mid-call: retried until the journal is empty.
 */
export async function emptyOpenReview(page: Page): Promise<void> {
  await expect(async () => {
    const left = await page.evaluate(async (id) => {
      const { journal } = await docmd.call("threads:whoami", id);
      if (journal && journal.ops.length > 0) await docmd.call("threads:discard-review", { ...id, reviewId: journal.review.id });
      return (await docmd.call("threads:whoami", id)).journal?.ops.length ?? 0;
    }, TEST_IDENTITY);
    expect(left).toBe(0);
  }).toPass({ timeout: 10_000 });
}

/**
 * Await a `page.evaluate` that may lose the race against the dev server's reload (a write makes
 * the page reload, which can destroy the evaluate's context before it replies). Only that
 * error is tolerated; any other rejection, such as a failed action, is rethrown. Callers assert
 * the outcome themselves (poll the journal or the served page).
 */
export async function tolerateReload<T>(call: Promise<T>): Promise<T | undefined> {
  try {
    return await call;
  } catch (e) {
    if (e instanceof Error && /Execution context was destroyed|Target (page, context or browser )?has been closed/i.test(e.message)) return undefined;
    throw e;
  }
}
