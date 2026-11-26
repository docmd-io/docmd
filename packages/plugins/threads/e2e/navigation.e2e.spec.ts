/**
 * SPA navigation tests - adapted from old headings-navigation.e2e.spec.ts
 * "SPA navigation" block.
 *
 * Changes from old plugin:
 * - No heading discuss buttons
 * - Threads are inline, not in a sidebar
 * - Navigation restores threads by triggering loadThreads + scanRenderedHighlights
 */

import { test, expect } from "@playwright/test";
import { Actor, NavigateTo, inlineCards, newThreadButton } from "./screenplay.ts";
import { inlineCard, setAuthor } from "./helpers.ts";



let user: Actor;

test.beforeEach(async ({ page }) => {
  user = new Actor("TestUser", page);
  await page.goto("/");
  await page.waitForSelector("threads-app", { state: "attached", timeout: 10_000 });
  await setAuthor(page, "TestUser");
});

/** Click the in-site link to the linked page; no page.goto, so a full reload would show as a lost marker. */
async function clickToLinkedPage(user: Actor): Promise<void> {
  await user.page.evaluate(() => {
    (window as unknown as Record<string, unknown>)["__spaMarker"] = true;
  });
  await user.page.locator("#main-content").getByRole("link", { name: "Linked page", exact: true }).click();
  await expect(user.page).toHaveURL(/\/linked\/?$/);
  await expect(inlineCard(user.page, "t-linked1")).toBeAttached({ timeout: 10_000 });
}

test.describe("SPA navigation", () => {
  test("threads-app is present after page load", async () => {
    await user.perform(NavigateTo.path("/"));
    const app = user.page.locator("threads-app");
    await expect(app).toBeAttached();
  });

  test("New Thread button is reinjected after SPA navigation", async () => {
    await user.perform(NavigateTo.path("/"));
    await clickToLinkedPage(user);

    // Client-side navigation: the document was not reloaded.
    expect(await user.page.evaluate(() => (window as unknown as Record<string, unknown>)["__spaMarker"])).toBe(true);
    await expect(user.page.locator("threads-app")).toBeAttached();
    await expect(newThreadButton(user.page)).toBeVisible({ timeout: 5_000 });
  });

  test("threads are page-scoped (pre-existing threads from markdown)", async () => {
    await user.perform(NavigateTo.path("/"));
    await expect(inlineCard(user.page, "t-thread1")).toBeAttached();

    await clickToLinkedPage(user);

    // The linked page shows its own thread and none of the first page's.
    await expect(inlineCards(user.page)).toHaveCount(1);
    await expect(inlineCard(user.page, "t-thread1")).toHaveCount(0);
  });
});
