/**
 * The Reviews tab in the sidebar drawer, on `docmd dev`: a review gets its title from the review section, is
 * published and listed with its author, state and a link per comment; the link scrolls to the highlight on the
 * open page and loads another page at its thread; Discard on a published review asks first.
 */

import * as fs from "node:fs";
import { test, expect } from "@playwright/test";
import { safePath } from "@docmd/utils";
import { tolerateReload, cleanThreads, emptyOpenReview, ensureAuthorProfile, removeAuthorProfile, setAuthor } from "./helpers.ts";
import type { Page } from "@playwright/test";

const site = process.env["THREADS_E2E_SITE"]!;
const manifests = safePath(site, "docs/.threads/reviews");
const secondPage = safePath(site, "docs/second.md");
const identity = { author: "TestUser", authorKey: "testuser" };

const manifestNames = (): string[] => (fs.existsSync(manifests) ? fs.readdirSync(manifests).sort() : []);
/** What this spec created, so it removes exactly that. */
let createdProfile = false;
let createdSecondPage = false;
let manifestsBefore: string[] = [];

test.beforeEach(() => {
  manifestsBefore = manifestNames();
});

test.afterEach(async ({ page }) => {
  if (page.url() === "about:blank") return;
  await emptyOpenReview(page);
  if (createdProfile) removeAuthorProfile();
  createdProfile = false;
  if (createdSecondPage) fs.rmSync(secondPage, { force: true });
  createdSecondPage = false;
  for (const name of manifestNames()) if (!manifestsBefore.includes(name)) fs.rmSync(safePath(manifests, name), { force: true });
  await cleanThreads(page);
});

async function load(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForSelector("threads-app", { state: "attached", timeout: 10_000 });
  await setAuthor(page, "TestUser");
  await cleanThreads(page);
  createdProfile = (await ensureAuthorProfile(page)) || createdProfile;
  await emptyOpenReview(page);
  await page.reload();
  await page.waitForSelector("threads-publish-widget", { state: "attached", timeout: 10_000 });
}

const firstWords = (page: Page): Promise<string> =>
  page.evaluate(() => (document.querySelector("main p, .content p, article p") as HTMLElement).textContent!.trim().split(" ").slice(0, 3).join(" "));

/** The ids of the add-thread ops in the caller's open review. */
const draftedIds = (page: Page): Promise<string[]> =>
  page.evaluate(async (id) => {
    const ops = (await docmd.call("threads:whoami", id)).journal?.ops ?? [];
    return ops.filter((op: { kind: string }) => op.kind === "add-thread").map((op: { threadId: string }) => op.threadId);
  }, identity);

/**
 * Draft a thread on the open page. The dev server may reload the page after a write, which can destroy the
 * evaluate's context before its reply: the journal, polled until it shows the draft, is the proof.
 */
async function addThread(page: Page, quote: string, body: string): Promise<string> {
  await tolerateReload(
    page.evaluate(
      async ({ quote, body, identity }) =>
        docmd.call("threads:add-thread", {
          file: document.body.dataset["sourceFile"],
          anchor: { quote, prefix: null, suffix: null, selector: null, offset: null, blockText: null },
          body,
          ...identity,
        }),
      { quote, body, identity },
    ),
  );
  let id = "";
  await expect.poll(async () => (id = (await draftedIds(page))[0] ?? ""), { message: "the draft in the journal" }).not.toBe("");
  return id;
}

/** Publish the caller's review and wait for the journal to empty. */
async function publish(page: Page): Promise<void> {
  await tolerateReload(page.evaluate((id) => docmd.call("threads:publish-review", id), identity));
  await expect.poll(() => draftedIds(page), { message: "the journal after publishing" }).toEqual([]);
}

/** Wait for the dev server to serve `path` with `text` in it (it rebuilds a moment after a write), so the next load has it. */
const served = (page: Page, path: string, text: string): Promise<void> =>
  expect.poll(async () => (await page.request.get(path)).text(), { message: `dev server build of ${path}` }).toContain(text);

/**
 * Run `check` with the drawer open on its Reviews tab, retried as a whole: the dev server reloads the page a moment
 * after a write, and a reload closes the drawer.
 */
async function inReviews(page: Page, check: () => Promise<void>): Promise<void> {
  await expect(async () => {
    if (!(await page.evaluate(() => document.body.classList.contains("tc-panel-open")))) await page.locator(".threads-fab").click({ timeout: 1_000 });
    await page.getByTestId("tab-reviews").click({ timeout: 1_000 });
    await check();
  }).toPass({ timeout: 15_000 });
}

test("a review gets its title, is listed with a link to its comment, and Discard on it asks first", async ({ page }) => {
  await load(page);
  const quote = await firstWords(page);
  const threadId = await addThread(page, quote, "reviews journey");
  await page.reload();
  await page.waitForSelector("threads-publish-widget", { state: "attached", timeout: 10_000 });

  // The title field belongs to the open review: Save puts the title in the journal.
  await page.locator(".threads-fab").click();
  await page.getByTestId("tpw-title").fill("My review");
  await page.getByTestId("tpw-summary").fill("Why these comments.\nSecond line.");
  await page.getByTestId("tpw-title-save").click();
  await expect
    .poll(() => page.evaluate(async (id) => (await docmd.call("threads:whoami", id)).journal.review.title, identity))
    .toBe("My review");
  await expect
    .poll(() => page.evaluate(async (id) => (await docmd.call("threads:whoami", id)).journal.review.summary, identity))
    .toBe("Why these comments.\nSecond line.");

  // The drawer shows the saved summary again after a reload.
  await page.reload();
  await page.waitForSelector("threads-publish-widget", { state: "attached", timeout: 10_000 });
  await page.locator(".threads-fab").click();
  await expect(page.getByTestId("tpw-summary")).toHaveValue("Why these comments.\nSecond line.");

  // Publishing from the review section lists the new review in the open Reviews tab, titled as saved.
  const entry = page.locator('[data-testid="review"]', { hasText: "My review" });
  await page.getByTestId("tab-reviews").click();
  await expect(entry).toHaveCount(0);
  await page.getByTestId("tpw-publish").click();
  await expect(entry).toBeVisible();
  await expect.poll(() => draftedIds(page), { message: "the journal after publishing" }).toEqual([]);
  // The next review starts without a summary: with a new draft the form is back, and its field is empty.
  await addThread(page, quote, "next review");
  await page.evaluate(() => (document.querySelector("threads-publish-widget") as unknown as { refresh(): Promise<void> }).refresh());
  await expect(page.getByTestId("tpw-summary")).toHaveValue("");
  await emptyOpenReview(page);
  await served(page, "/", `data-thread-id="${threadId}"`);
  await page.reload();
  await page.waitForSelector("threads-publish-widget", { state: "attached", timeout: 10_000 });

  await inReviews(page, async () => {
    await expect(entry).toBeVisible({ timeout: 1_000 });
    await expect(entry).toContainText("TestUser", { timeout: 1_000 });
    await expect(entry.getByTestId("review-state")).toHaveText("Published", { timeout: 1_000 });
    await expect(entry.getByTestId("review-op")).toHaveText(quote, { timeout: 1_000 });
    await expect(entry.getByTestId("review-op")).toHaveAttribute("href", new RegExp(`#thread-${threadId}$`), { timeout: 1_000 });
    await expect(entry.locator("threads-discard-review")).toHaveCount(1, { timeout: 1_000 });
  });

  // A link to the open page scrolls to the highlight and flashes it. Scroll away first so the check can fail.
  const mark = page.locator(`mark.threads-highlight[data-thread-id="${threadId}"]`);
  await expect(mark).toHaveCount(1);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(mark).not.toBeInViewport();
  await entry.getByTestId("review-op").click();
  await expect(mark).toBeInViewport();
  await expect(mark).toHaveClass(/threads-thread--flash/);

  // The same link again points at the URL already open, so the browser fires nothing: the thread is still revealed.
  await expect(mark).not.toHaveClass(/threads-thread--flash/);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(mark).not.toBeInViewport();
  await entry.getByTestId("review-op").click();
  await expect(mark).toBeInViewport();
  await expect(mark).toHaveClass(/threads-thread--flash/);

  // Cancel keeps the review; the open review's own section is not involved (nothing is drafted, so it has no Discard).
  await entry.getByTestId("discard-open").click();
  await expect(entry.getByTestId("discard-dialog")).toBeVisible();
  await expect(page.locator("threads-publish-widget threads-discard-review")).toHaveCount(0);
  await entry.getByTestId("discard-cancel").click();
  await expect(entry.getByTestId("discard-dialog")).toBeHidden();
  await expect(entry).toHaveAttribute("data-state", "published");

  // Confirm discards it: the entry says so and has no Discard.
  await entry.getByTestId("discard-open").click();
  // The tab refreshes itself on success: watch this very entry (the dev server reloads the page soon after).
  const handle = await entry.elementHandle();
  await entry.getByTestId("discard-confirm").click();
  await page.waitForFunction(
    (el) => el?.getAttribute("data-state") === "discarded" && !el.querySelector('[data-testid="discard-open"]'),
    handle,
  );
  await inReviews(page, async () => {
    await expect(entry).toHaveAttribute("data-state", "discarded", { timeout: 1_000 });
    await expect(entry.getByTestId("review-state")).toHaveText("Discarded", { timeout: 1_000 });
    await expect(entry.getByTestId("discard-open")).toHaveCount(0, { timeout: 1_000 });
  });
});

test("a link from another page loads the page, scrolls to the thread and flashes it", async ({ page }) => {
  await load(page);
  const filler = Array.from({ length: 40 }, (_, i) => `Filler paragraph ${i + 1} keeps the quoted text below the fold.`).join("\n\n");
  createdSecondPage = true;
  // `docmd dev` can drop a save made right after a rebuild: write again until the page is served.
  for (let attempt = 1; ; attempt++) {
    fs.writeFileSync(secondPage, `---\ntitle: Second page\n---\n\n# Second page\n\n${filler}\n\nThe needle phrase sits at the very end of this page.\n`, "utf8");
    try {
      await expect.poll(async () => (await page.request.get("/second/")).text(), { timeout: 4_000 }).toContain("needle phrase");
      break;
    } catch (e) {
      if (attempt === 3) throw e;
    }
  }

  await page.goto("/second/");
  await page.waitForSelector("threads-publish-widget", { state: "attached", timeout: 10_000 });
  const threadId = await addThread(page, "needle phrase", "cross page");
  await publish(page);
  await served(page, "/second/", `data-thread-id="${threadId}"`);

  await page.goto("/");
  await page.waitForSelector("threads-publish-widget", { state: "attached", timeout: 10_000 });
  const link = page.locator('[data-testid="review"]', { hasText: "needle phrase" }).getByTestId("review-op");
  await inReviews(page, async () => {
    await expect(link).toBeVisible({ timeout: 1_000 });
  });
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/second/#thread-${threadId}$`));
  const mark = page.locator(`mark.threads-highlight[data-thread-id="${threadId}"]`);
  await expect(mark).toBeInViewport({ timeout: 10_000 });
  await expect(mark).toHaveClass(/threads-thread--flash/);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});
