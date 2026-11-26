/**
 * A thread's colour says where it stands: blue when published and open, green when resolved, orange while it is a
 * draft. The highlight in the article, the inline card and the sidebar's copy of the card all use the same colour,
 * and the card's left border is that colour's strong token.
 */

import { test, expect, type Locator } from "@playwright/test";
import { cleanThreads, emptyOpenReview, inlineCard, openPanel, panelCard, seedAndReload, setAuthor, tolerateReload } from "./helpers.ts";

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

/** The colour a CSS value resolves to, as the browser reports it (`rgb(...)`). */
async function resolved(page: import("@playwright/test").Page, value: string): Promise<string> {
  return page.evaluate((v) => {
    const probe = document.createElement("span");
    probe.style.borderLeft = `3px solid ${v}`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).borderLeftColor;
    probe.remove();
    return colour;
  }, value);
}

const borderOf = (card: Locator): Promise<string> =>
  card.locator('[part~="card"]').first().evaluate((el) => getComputedStyle(el).borderLeftColor);

/** The strong border token of a highlight name, as the browser resolves it. */
const strongOf = (page: import("@playwright/test").Page, name: "blue" | "green" | "orange", faded: boolean): Promise<string> =>
  resolved(page, faded ? `color-mix(in oklab, var(--threads-hl-${name}-strong) 50%, transparent)` : `var(--threads-hl-${name}-strong)`);

/** The mark, the inline card and the panel's card of a thread all wear `name`, and the card's border is its strong token (half faded once resolved). */
async function expectColour(page: import("@playwright/test").Page, id: string, name: "blue" | "green" | "orange", faded = false): Promise<void> {
  const strong = await strongOf(page, name, faded);
  const inline = inlineCard(page, id);
  await expect(inline).toBeVisible({ timeout: 10_000 });
  await expect(inline).toHaveAttribute("color", name);
  await expect(page.locator(`mark.threads-highlight[data-thread-id="${id}"]`).first()).toHaveClass(new RegExp(`threads-hl-${name}\\b`));
  expect(await borderOf(inline)).toBe(strong);

  await openPanel(page);
  const card = panelCard(page, id);
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("color", name);
  expect(await borderOf(card)).toBe(strong);
}

test("a published open thread is blue, in the text, inline and in the sidebar", async ({ page }) => {
  const { id } = await seedAndReload(page, { body: "Published coloured thread", anchor: { quote: "verify core engine" } });
  await expectColour(page, id, "blue");
});

test("a resolved thread is green", async ({ page }) => {
  const { id } = await seedAndReload(page, { body: "Resolved coloured thread", anchor: { quote: "Markdown parser" }, resolved: true });
  await expectColour(page, id, "green", true);
});

test("a thread that is still a draft is orange until it is published", async ({ page }) => {
  await tolerateReload(
    page.evaluate(
      async (identity) =>
        docmd.call("threads:add-thread", {
          file: document.body.dataset["sourceFile"],
          anchor: { quote: "verify core engine", prefix: null, suffix: null, selector: null, offset: null, blockText: null },
          body: "Draft coloured thread",
          ...identity,
        }),
      { author: "TestUser", authorKey: "testuser" },
    ),
  );
  await page.reload();
  await page.waitForSelector("threads-app", { state: "attached", timeout: 10_000 });
  const draft = page.locator("threads-thread[draft][variant='inline']").first();
  await expect(draft).toBeVisible({ timeout: 10_000 });
  const id = (await draft.getAttribute("data-thread-id"))!;
  await expectColour(page, id, "orange");
});

test("a thread whose text is gone has the neutral border", async ({ page }) => {
  const { id } = await seedAndReload(page, { body: "Thread of removed text", anchor: { quote: "text that is not on this page at all" } });
  await openPanel(page);
  const card = panelCard(page, id);
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toHaveAttribute("orphaned", "");
  await expect(card).toHaveAttribute("color", "neutral");
});
