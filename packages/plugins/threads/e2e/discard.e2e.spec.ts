/**
 * Discarding the open review: draft a comment, Discard asks first (Cancel keeps it), Confirm drops
 * the draft from the widget and the page without touching the markdown or writing a manifest.
 */

import * as fs from "node:fs";
import { test, expect } from "@playwright/test";
import { safePath } from "@docmd/utils";
import { tolerateReload, cleanThreads, emptyOpenReview, ensureAuthorProfile, removeAuthorProfile, setAuthor } from "./helpers.ts";

const site = process.env["THREADS_E2E_SITE"]!;
const index = safePath(site, "docs/index.md");
const manifests = safePath(site, "docs/.threads/reviews");
const identity = { author: "TestUser", authorKey: "testuser" };

/** Whether this spec created the author profile file, and so removes it again. */
let createdProfile = false;

const manifestNames = (): string[] => (fs.existsSync(manifests) ? fs.readdirSync(manifests).sort() : []);

test.afterEach(async ({ page }) => {
  if (page.url() === "about:blank") return; // the test failed before the page loaded: nothing was drafted
  await emptyOpenReview(page);
  if (createdProfile) removeAuthorProfile();
  createdProfile = false;
});

test("Discard asks first, then drops the drafts and leaves the markdown and manifests alone", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("threads-app", { state: "attached", timeout: 10_000 });
  await setAuthor(page, "TestUser");
  await cleanThreads(page);
  createdProfile = await ensureAuthorProfile(page);
  await emptyOpenReview(page);
  await page.reload();
  await page.waitForSelector("threads-publish-widget", { state: "attached", timeout: 10_000 });
  const before = fs.readFileSync(index);
  const manifestsBefore = manifestNames();
  const drafted = page.getByText("to be discarded");

  const para = page.locator("main p, .content p, article p").first();
  const quote = (await para.textContent())!.trim().split(" ").slice(0, 3).join(" ");
  // The dev server may reload the page after a write (when the author profile file changes) and the reload can beat
  // the evaluate's reply: read the thread id from the journal instead, then reload ourselves.
  await tolerateReload(
    page.evaluate(
      async ({ quote }) =>
        docmd.call("threads:add-thread", {
          file: document.body.dataset["sourceFile"],
          anchor: { quote, prefix: null, suffix: null, selector: null, offset: null, blockText: null },
          author: "TestUser",
          authorKey: "testuser",
          body: "to be discarded",
        }),
      { quote },
    ),
  );
  let threadId = "";
  await expect
    .poll(async () => (threadId = await page.evaluate(async (id) => ((await docmd.call("threads:whoami", id)).journal?.ops.find((op: { kind: string }) => op.kind === "add-thread") as { threadId?: string } | undefined)?.threadId ?? "", identity)))
    .not.toBe("");
  await page.reload();
  await page.waitForSelector("threads-publish-widget", { state: "attached", timeout: 10_000 });

  // The review section lives in the drawer: open it first.
  const count = page.getByTestId("tpw-count");
  const open = page.getByTestId("discard-open");
  // Retried as a whole: a late dev-server reload closes the drawer.
  await expect(async () => {
    if (!(await page.evaluate(() => document.body.classList.contains("tc-panel-open")))) await page.locator(".threads-fab").click();
    await expect(count).toHaveText("1 unpublished comment", { timeout: 1_000 });
    // The draft is not in the served markdown: its card is in the drawer body.
    await expect(page.locator(".tc-panel__body").getByText("to be discarded")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  // The client highlights its quote after the load.
  const mark = page.locator(`mark.threads-highlight[data-thread-id="${threadId}"]`);
  await expect(mark).toHaveCount(1);
  await expect(mark).toContainText(quote);

  // Cancel closes the dialog and changes nothing.
  await open.click();
  await expect(page.getByTestId("discard-dialog")).toBeVisible();
  await expect(page.getByTestId("discard-dialog")).toContainText("(1)");
  await page.getByTestId("discard-cancel").click();
  await expect(page.getByTestId("discard-dialog")).toBeHidden();
  await expect(count).toHaveText("1 unpublished comment");

  // Confirm empties the review and the page.
  await open.click();
  await page.getByTestId("discard-confirm").click();
  await expect(count).toHaveText("0 unpublished comments");
  await expect(drafted).toHaveCount(0);
  await expect(mark).toHaveCount(0);
  await expect(para).toContainText(quote);
  await expect(open).toHaveCount(0);

  expect(fs.readFileSync(index).equals(before)).toBe(true);
  expect(manifestNames()).toEqual(manifestsBefore);
});
