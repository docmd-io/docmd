/**
 * The static fallback: without JavaScript the build's own HTML (the `.threads-sidebar` list of threads) is what a
 * reader sees; with JavaScript it is replaced by the cards, and selecting text inside a card does not offer a new
 * comment.
 */

import { test, expect } from "@playwright/test";
import { cleanThreads, emptyOpenReview, inlineCard, seedAndReload, setAuthor } from "./helpers.ts";
import { Actor, SelectText } from "./screenplay.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("threads-app", { state: "attached", timeout: 10_000 });
  await setAuthor(page, "TestUser");
  await cleanThreads(page);
});

test.afterEach(async ({ page }) => {
  if (page.url() === "about:blank") return;
  await emptyOpenReview(page);
  await cleanThreads(page);
});

test("without JavaScript the build's list of threads is in the page and the plugin does not hide it", async ({ page, browser, baseURL }) => {
  const { id } = await seedAndReload(page, { body: "Visible without scripts", anchor: { quote: "verify core engine" } });
  const url = page.url();

  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  try {
    const plain = await context.newPage();
    await plain.goto(url);
    const thread = plain.locator(`.threads-sidebar .threads-thread[data-thread-id="${id}"]`);
    await expect(thread).toBeAttached();
    await expect(thread).toContainText("Visible without scripts");
    await expect(thread).toContainText("TestUser");
    // docmd's own page-wide `html { visibility: hidden }` guard waits for a script, so what the plugin controls is
    // checked: its list is laid out (not display:none, not hidden) and no component replaced it.
    const state = await thread.evaluate((el) => {
      const list = el.closest(".threads-sidebar")!;
      return { display: getComputedStyle(list).display, hidden: list.hasAttribute("hidden"), components: document.querySelectorAll("threads-thread").length };
    });
    expect(state.display).not.toBe("none");
    expect(state.hidden).toBe(false);
    expect(state.components).toBe(0);
    // The highlighted text is in the article too
    await expect(plain.locator("mark.threads-highlight").first()).toBeAttached();
  } finally {
    await context.close();
  }
});

test("with JavaScript the build's list is replaced by the cards", async ({ page }) => {
  const { id } = await seedAndReload(page, { body: "Replaced by a card", anchor: { quote: "verify core engine" } });
  await expect(inlineCard(page, id)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(`.threads-sidebar .threads-thread[data-thread-id="${id}"]`)).toBeHidden();
});

test("a thread is still readable when the script bundle fails to load", async ({ page }) => {
  await seedAndReload(page, { body: "Readable without the bundle", anchor: { quote: "verify core engine" } });
  await page.route(/threads[^/]*\.js(\?.*)?$/, (route) => route.abort());
  await page.goto(page.url());
  const thread = page.locator(".threads-sidebar .threads-thread", { hasText: "Readable without the bundle" });
  await expect(thread).toBeVisible();
});

test("selecting text inside a card does not offer a new comment", async ({ page }) => {
  const { id } = await seedAndReload(page, { body: "Select some of this text", anchor: { quote: "verify core engine" } });
  const card = inlineCard(page, id);
  await expect(card).toBeVisible({ timeout: 10_000 });
  // A real triple-click selects the comment's paragraph
  await card.locator('[part~="body"]').first().click({ clickCount: 3 });
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).not.toBe("");
  await page.waitForTimeout(500);
  await expect(page.getByRole("button", { name: "Add comment", exact: true })).toHaveCount(0);

  // Control: the same gesture on article text does offer it
  await new Actor("TestUser", page).perform(new SelectText("[data-docmd-content] p, .docmd-content p, article p, main p", "verify core engine"));
  await expect(page.getByRole("button", { name: "Add comment", exact: true })).toBeVisible();
});
