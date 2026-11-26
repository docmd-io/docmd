/**
 * A thread's colour: the highlight in the article, the inline card and the sidebar's copy of the card all use
 * the same colour, and the card's left border is that colour's strong token.
 */

import { test, expect, type Locator } from "@playwright/test";
import { cleanThreads, emptyOpenReview, inlineCard, openPanel, panelCard, seedAndReload, setAuthor } from "./helpers.ts";

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

test("each thread's card takes its highlight's colour, inline and in the sidebar", async ({ page }) => {
  const first = await seedAndReload(page, { body: "First coloured thread", anchor: { quote: "verify core engine" } });
  const second = await seedAndReload(page, { body: "Second coloured thread", anchor: { quote: "Markdown parser" } });

  const strong: Record<string, string> = {
    yellow: await resolved(page, "var(--threads-hl-yellow-strong, hsl(48 96% 45%))"),
    blue: await resolved(page, "var(--threads-hl-blue-strong, hsl(210 100% 45%))"),
  };

  const colours: string[] = [];
  for (const { id } of [first, second]) {
    const inline = inlineCard(page, id);
    await expect(inline).toBeVisible({ timeout: 10_000 });
    const name = await inline.getAttribute("color");
    expect(name, "an anchored thread has a highlight colour, not neutral").toMatch(/^(yellow|blue)$/);
    colours.push(name!);

    // The article's highlight carries the same colour
    await expect(page.locator(`mark.threads-hl-${name}`).first()).toBeAttached();
    expect(await borderOf(inline)).toBe(strong[name!]);
  }
  expect(new Set(colours).size, "two threads get two colours").toBe(2);

  await openPanel(page);
  for (const [i, { id }] of [first, second].entries()) {
    const card = panelCard(page, id);
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("color", colours[i]!);
    expect(await borderOf(card)).toBe(strong[colours[i]!]);
  }
});

test("a thread whose text is gone has the neutral border", async ({ page }) => {
  const { id } = await seedAndReload(page, { body: "Thread of removed text", anchor: { quote: "text that is not on this page at all" } });
  await openPanel(page);
  const card = panelCard(page, id);
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toHaveAttribute("orphaned", "");
  await expect(card).toHaveAttribute("color", "neutral");
});
