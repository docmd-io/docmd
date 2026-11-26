/**
 * One base button style across the review UI, on `docmd dev` with the drawer open: the review section's Publish,
 * Save, play/pause and Discard, the discard confirmation's Cancel and Confirm, and the Discard of a published
 * review in the Reviews tab share height, padding, font and radius; the Discard triggers use the danger token.
 * Everything is compared inside one page (button against button, trigger against the token), never to pixel values.
 */

import * as fs from "node:fs";
import { test, expect } from "@playwright/test";
import { safePath } from "@docmd/utils";
import { cleanThreads, emptyOpenReview, ensureAuthorProfile, removeAuthorProfile, setAuthor } from "./helpers.ts";
import type { Locator, Page } from "@playwright/test";

const site = process.env["THREADS_E2E_SITE"]!;
const manifests = safePath(site, "docs/.threads/reviews");
const identity = { author: "TestUser", authorKey: "testuser" };

const manifestNames = (): string[] => (fs.existsSync(manifests) ? fs.readdirSync(manifests).sort() : []);
/** What this spec created, so it removes exactly that. */
let createdProfile = false;
let manifestsBefore: string[] = [];

test.beforeEach(() => {
  manifestsBefore = manifestNames();
});

test.afterEach(async ({ page }) => {
  if (page.url() === "about:blank") return; // the test failed before the page loaded: nothing was drafted
  await emptyOpenReview(page);
  if (createdProfile) removeAuthorProfile();
  createdProfile = false;
  for (const name of manifestNames()) if (!manifestsBefore.includes(name)) fs.rmSync(safePath(manifests, name), { force: true });
  await cleanThreads(page);
});

interface Look {
  height: number;
  padding: string[];
  fontFamily: string;
  fontSize: string;
  radius: string;
}

/** The look of the element the user clicks: a `<button>` itself, an `<sl-button>`'s `base` part. */
function lookOf(button: Locator): Promise<Look> {
  return button.evaluate((el) => {
    const target = el.tagName === "SL-BUTTON" ? (el.shadowRoot!.querySelector("[part~=base]") as HTMLElement) : el;
    const c = getComputedStyle(target);
    return {
      // Layout height: the dialog's open animation scales its content, which getBoundingClientRect would show.
      height: target.offsetHeight,
      padding: [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft],
      fontFamily: c.fontFamily,
      fontSize: c.fontSize,
      radius: c.borderTopLeftRadius,
    };
  });
}

/** The computed colour of a Shoelace token, resolved the way a button's own colour is. */
function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.documentElement.appendChild(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, token);
}

const colorsOf = (button: Locator): Promise<string[]> =>
  button.evaluate((el) => {
    const c = getComputedStyle(el);
    return [c.color, c.backgroundColor, c.borderTopColor];
  });

/** The five values every button of the review UI shares. */
function expectSameBase(a: Look, b: Look): void {
  expect(a.height).toBe(b.height);
  expect(a.padding).toEqual(b.padding);
  expect(a.fontFamily).toBe(b.fontFamily);
  expect(a.fontSize).toBe(b.fontSize);
  expect(a.radius).toBe(b.radius);
}

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

/**
 * Draft a thread on the open page. The dev server may reload the page after a write, which can destroy the
 * evaluate's context before its reply: the journal, polled until it shows the draft, is the proof.
 */
async function addThread(page: Page, body: string): Promise<void> {
  const quote = await page.evaluate(() => (document.querySelector("main p, .content p, article p") as HTMLElement).textContent!.trim().split(" ").slice(0, 3).join(" "));
  await page
    .evaluate(
      async ({ quote, body, identity }) =>
        docmd.call("threads:add-thread", {
          file: document.body.dataset["sourceFile"],
          anchor: { quote, prefix: null, suffix: null, selector: null, offset: null, blockText: null },
          body,
          ...identity,
        }),
      { quote, body, identity },
    )
    .catch(() => null);
  await expect
    .poll(() => page.evaluate(async (id) => (await docmd.call("threads:whoami", id)).journal?.ops.length ?? 0, identity), { message: "the draft in the journal" })
    .toBeGreaterThan(0);
}

/** Run `check` with the drawer open, retried as a whole: a dev-server reload closes the drawer. */
async function inDrawer(page: Page, check: () => Promise<void>): Promise<void> {
  await expect(async () => {
    if (!(await page.evaluate(() => document.body.classList.contains("tc-panel-open")))) await page.locator(".threads-fab").click({ timeout: 1_000 });
    await check();
  }).toPass({ timeout: 15_000 });
}

test("the review section and the discard confirmation share one button base; Discard is danger-coloured", async ({ page }) => {
  await load(page);
  await addThread(page, "button style");
  await page.reload();
  await page.waitForSelector("threads-publish-widget", { state: "attached", timeout: 10_000 });

  const publish = page.getByTestId("tpw-publish");
  const save = page.getByTestId("tpw-title-save");
  const playPause = page.getByTestId("tpw-playpause");
  const discard = page.getByTestId("discard-open");
  await inDrawer(page, async () => {
    for (const b of [publish, save, discard]) await expect(b).toBeVisible({ timeout: 1_000 });
  });

  const base = await lookOf(publish);
  expectSameBase(await lookOf(save), base);
  expectSameBase(await lookOf(discard), base);
  // Icon-only: the height, font size and radius are shared; its width and padding stay its own.
  const icon = await lookOf(playPause);
  expect(icon.height).toBe(base.height);
  expect(icon.fontSize).toBe(base.fontSize);
  expect(icon.radius).toBe(base.radius);

  // The confirmation's buttons, then Cancel keeps the draft.
  await discard.click();
  await expect(page.getByTestId("discard-dialog")).toBeVisible();
  expectSameBase(await lookOf(page.getByTestId("discard-cancel")), base);
  expectSameBase(await lookOf(page.getByTestId("discard-confirm")), base);
  await page.getByTestId("discard-cancel").click();
  await expect(page.getByTestId("discard-dialog")).toBeHidden();

  // Discard wears the danger token; Publish keeps the primary one.
  const danger = await tokenColor(page, "--sl-color-danger-600");
  expect(await colorsOf(discard)).toContain(danger);
  const primary = await tokenColor(page, "--sl-color-primary-600");
  expect((await colorsOf(publish))[1]).toBe(primary);
});

test("Discard on a published review in the Reviews tab is on the same base and danger-coloured", async ({ page }) => {
  await load(page);
  await addThread(page, "button style reviews");
  await page.reload();
  await page.waitForSelector("threads-publish-widget", { state: "attached", timeout: 10_000 });
  const reference = page.getByTestId("tpw-publish");
  await inDrawer(page, async () => {
    await expect(reference).toBeVisible({ timeout: 1_000 });
  });

  // Read before the write: the token does not change, and a reload after Publish would destroy an evaluate.
  const danger = await tokenColor(page, "--sl-color-danger-600");
  await reference.click();
  // The dev server reloads the page a moment after the write and a reload closes the drawer: open the Reviews tab,
  // read the trigger and compare it as one retried block.
  const entry = page.locator('[data-testid="review"]').first();
  const discard = entry.getByTestId("discard-open");
  await expect(async () => {
    if (!(await page.evaluate(() => document.body.classList.contains("tc-panel-open")))) await page.locator(".threads-fab").click({ timeout: 1_000 });
    await page.getByTestId("tab-reviews").click({ timeout: 1_000 });
    await expect(discard).toBeVisible({ timeout: 1_000 });
    expectSameBase(await lookOf(discard), await lookOf(page.getByTestId("tpw-publish")));
    expect(await colorsOf(discard)).toContain(danger);
  }).toPass({ timeout: 15_000 });

  // Leave nothing published: confirm the discard, retried the same way.
  await expect(async () => {
    if (!(await page.evaluate(() => document.body.classList.contains("tc-panel-open")))) await page.locator(".threads-fab").click({ timeout: 1_000 });
    await page.getByTestId("tab-reviews").click({ timeout: 1_000 });
    // Idempotent: an earlier attempt may have confirmed before a reload, and a discarded entry has no Discard.
    if ((await entry.getAttribute("data-state", { timeout: 1_000 })) === "discarded") return;
    if (!(await entry.getByTestId("discard-dialog").isVisible())) await discard.click({ timeout: 1_000 });
    await entry.getByTestId("discard-confirm").click({ timeout: 1_000 });
    await expect(entry).toHaveAttribute("data-state", "discarded", { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
});
