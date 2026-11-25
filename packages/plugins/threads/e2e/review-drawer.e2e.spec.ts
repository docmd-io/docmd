/**
 * The review UI lives in the sidebar drawer: the publish section is inside it (never on the body), the FAB and
 * the toggle strip count unpublished comments while the drawer is closed, and a thread whose quote is gone from
 * the page is listed apart, with a line telling its author.
 */

import * as fs from "node:fs";
import { test, expect } from "@playwright/test";
import { safePath } from "@docmd/utils";
import { cleanThreads, mainOf, setAuthor } from "./helpers.ts";
import type { Page } from "@playwright/test";

const site = process.env["THREADS_E2E_SITE"]!;
const index = safePath(site, "docs/index.md");
const manifests = safePath(site, "docs/.threads/reviews");
const identity = { author: "TestUser", authorKey: "testuser" };

const manifestNames = (): string[] => (fs.existsSync(manifests) ? fs.readdirSync(manifests).sort() : []);
let manifestsBefore: string[] = [];

/** Empty the caller's open review, so a test starts from a journal with no ops whatever ran before it. */
async function emptyOpenReview(page: Page): Promise<void> {
  await page.evaluate(async (id) => {
    const { journal } = await docmd.call("threads:whoami", id);
    if (journal && journal.ops.length > 0) await docmd.call("threads:discard-review", { ...id, reviewId: journal.review.id });
  }, identity);
}

async function load(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForSelector("threads-app", { state: "attached", timeout: 10_000 });
  await setAuthor(page, "TestUser");
  await cleanThreads(page);
  await emptyOpenReview(page);
  await page.reload();
  await page.waitForSelector("threads-publish-widget", { state: "attached", timeout: 10_000 });
}

/** The first words of the page's first paragraph: text the page certainly has. */
async function firstWords(page: Page): Promise<string> {
  return ((await page.locator("main p, .content p, article p").first().textContent())!).trim().split(" ").slice(0, 3).join(" ");
}

async function addThread(page: Page, quote: string, body: string): Promise<string> {
  return page.evaluate(
    async ({ quote, body, identity }) =>
      (await docmd.call("threads:add-thread", {
        file: document.body.dataset["sourceFile"],
        anchor: { quote, prefix: null, suffix: null, selector: null, offset: null, blockText: null },
        body,
        ...identity,
      })).id as string,
    { quote, body, identity },
  );
}

const publish = (page: Page) => page.evaluate((id) => docmd.call("threads:publish-review", id), identity);

test.beforeEach(() => {
  manifestsBefore = manifestNames();
});

test.afterEach(async ({ page }) => {
  if (page.url() === "about:blank") return;
  // Leave the site as found: no open review, no manifest of ours, the page markdown restored.
  await emptyOpenReview(page);
  for (const name of manifestNames()) if (!manifestsBefore.includes(name)) fs.rmSync(safePath(manifests, name), { force: true });
  await cleanThreads(page);
});

test("the review section is in the drawer; the FAB and the toggle strip count unpublished comments until they are published", async ({ page }) => {
  await load(page);
  await expect(page.locator("body > threads-publish-widget")).toHaveCount(0);
  const section = page.locator(".tc-panel threads-publish-widget");
  await expect(section).toHaveCount(1);
  await expect(section).toBeHidden(); // attached while the drawer is closed
  await expect(page.locator(".threads-fab .tc-unpublished-marker")).toHaveCount(0);

  const quote = await firstWords(page);
  await Promise.all([page.waitForEvent("load"), addThread(page, quote, "drawer draft")]); // the dev server reloads the page after the write
  await page.waitForSelector("threads-publish-widget", { state: "attached", timeout: 10_000 });
  const fabMarker = page.locator(".threads-fab .tc-unpublished-marker");
  await expect(fabMarker).toHaveText("1");
  await expect(fabMarker).toHaveAttribute("title", "1 unpublished comment");
  await expect(page.locator(".tc-sidebar-toggle .tc-unpublished-marker")).toHaveText("1");
  await expect(section).toBeHidden();

  await page.locator(".threads-fab").click();
  await expect(section).toBeVisible();
  await expect(section).toBeInViewport(); // pinned below the list, not pushed off the drawer
  await expect(page.getByTestId("tpw-count")).toHaveText("1 unpublished comment");
  await expect(page.getByTestId("tpw-publish")).toBeEnabled();
  await expect(page.getByTestId("discard-open")).toBeVisible();

  await page.getByTestId("tpw-publish").click();
  await expect(page.getByTestId("tpw-count")).toHaveText("0 unpublished comments");
  await expect(page.locator(".tc-unpublished-marker")).toHaveCount(0);
});

test("a published thread whose quote left the page is in the Orphaned group with its quote, and its author is told", async ({ page }) => {
  await load(page);
  const quote = await firstWords(page);
  const id = await addThread(page, quote, "will lose its anchor");
  await publish(page);
  // The page's markdown no longer marks the quote (the dev server rebuilds on the write).
  const marked = fs.readFileSync(index, "utf8");
  expect(marked).toContain(`==${quote}==`);
  fs.writeFileSync(index, marked.replace(new RegExp(`==${quote}==\\{${id}\\}`), "rewritten"), "utf8");
  await expect.poll(async () => mainOf(await (await page.request.get("/")).text()), { message: "dev server rebuild of /" }).toContain("rewritten");
  await page.reload();
  await page.waitForSelector("threads-publish-widget", { state: "attached", timeout: 10_000 });
  await page.locator(".threads-fab").click();

  const group = page.getByTestId("orphaned-group");
  await expect(group).toContainText("Orphaned");
  await expect(group.locator(`.threads-thread[data-thread-id="${id}"]`)).toContainText(quote);
  await expect(page.locator(`.tc-panel__body > .threads-thread[data-thread-id="${id}"]`)).toHaveCount(0);
  await expect(page.getByTestId("tpw-orphan")).toHaveText("1 of your comments lost its anchor");
});
