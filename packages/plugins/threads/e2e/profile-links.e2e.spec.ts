/**
 * Profile links: a person's name links to their profile wherever it is shown (comment author, reactor, review
 * author). The link is worked out when the page renders from the site's `profileUrl` pattern and `authors.json`,
 * never stored in the Markdown; a person can set their own link or turn linking off in the identity panel
 * ("Profile link"), and the setting applies to their name everywhere.
 *
 * The site's `profileUrl` is read by the client from `window.__threads_config`; the specs set it for the page
 * (see `overrideSiteConfig`), as the e2e site itself is configured without one.
 */

import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  cleanThreads,
  clientKey,
  emptyOpenReview,
  ensureAuthorProfile,
  inlineCard,
  openPanel,
  overrideSiteConfig,
  publishReview,
  removeAuthorProfile,
  seedAndReload,
  setAuthor,
  waitForReload,
} from "./helpers.ts";
import { Actor, StartThreadOn, inlineCards } from "./screenplay.ts";

const ANCHOR = { quote: "verify core engine" };
const PATTERN = "https://github.com/{id}";
const contentSelector = "[data-docmd-content] p, .docmd-content p, article p, main p";

let createdProfile = false;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("threads-app", { state: "attached", timeout: 10_000 });
  await setAuthor(page, "TestUser");
  await cleanThreads(page);
});

test.afterEach(async ({ page }) => {
  if (page.url() === "about:blank") return;
  await emptyOpenReview(page);
  if (createdProfile) removeAuthorProfile();
  createdProfile = false;
  await cleanThreads(page);
});

const author = (card: Locator): Locator => card.locator('[part~="author"]').first();

test.describe("names link to the profile pattern", () => {
  test("a comment's author name links to the profile built from the site's pattern", async ({ page }) => {
    await overrideSiteConfig(page, { profileUrl: PATTERN });
    const { id } = await seedAndReload(page, { body: "Comment with a linked author", anchor: ANCHOR });
    const card = inlineCard(page, id);
    await expect(card).toBeVisible({ timeout: 10_000 });

    // The seeded comment's identity key is its author's name
    const link = card.locator('a[part~="author"]').first();
    await expect(link).toHaveText("TestUser");
    await expect(link).toHaveAttribute("href", "https://github.com/TestUser");
    await expect(link).toHaveAttribute("rel", "nofollow noopener ugc");
    // The sidebar's copy of the card links the same way
    await openPanel(page);
    await expect(page.locator(`threads-panel threads-thread[data-thread-id="${id}"] a[part~="author"]`).first()).toHaveAttribute("href", "https://github.com/TestUser");
  });

  test("the name in a draft comment links before the review is published", async ({ page }) => {
    await overrideSiteConfig(page, { profileUrl: PATTERN });
    await page.reload();
    await page.waitForSelector("threads-app", { state: "attached", timeout: 10_000 });
    await setAuthor(page, "TestUser");
    await new Actor("TestUser", page).perform(StartThreadOn.on(contentSelector, "verify core engine", "A draft with a linked author"));
    const card = inlineCards(page).filter({ hasText: "A draft with a linked author" });
    await expect(card.locator('a[part~="author"]').first()).toHaveAttribute("href", /^https:\/\/github\.com\/./);
  });

  test("without a profile pattern the name is plain text", async ({ page }) => {
    const { id } = await seedAndReload(page, { body: "Comment with a plain author", anchor: ANCHOR });
    const card = inlineCard(page, id);
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(author(card)).toHaveText("TestUser");
    await expect(card.locator('a[part~="author"]')).toHaveCount(0);
  });

  test("the author of a review in the Reviews tab links the same way", async ({ page }) => {
    await overrideSiteConfig(page, { profileUrl: PATTERN });
    await seedAndReload(page, { body: "Comment of a published review", anchor: ANCHOR });
    await page.reload();
    await openPanel(page);
    await page.getByTestId("tab-reviews").click();
    const link = page.getByTestId("review").first().locator('a[part~="author"]');
    await expect(link).toHaveText("TestUser");
    await expect(link).toHaveAttribute("href", "https://github.com/TestUser");
  });
});

test.describe("the Profile link setting", () => {
  /**
   * Open the identity panel, run `fill` on its Profile link group (the radios are disabled until the stored setting
   * is read, so the pick waits for that), and save.
   */
  async function saveProfileLink(page: Page, fill: (group: Locator) => Promise<void>): Promise<void> {
    const identity = page.locator("threads-identity");
    await identity.getByRole("button", { name: "Discussion identity" }).click();
    const group = identity.getByRole("group", { name: "Profile link" });
    await fill(group);
    await identity.getByRole("button", { name: "Save" }).click();
  }

  /**
   * Write a thread through the UI and publish it: the viewer's own comment, keyed by the viewer's stored key.
   */
  async function publishOwnComment(page: Page, text: string): Promise<Locator> {
    await new Actor("TestUser", page).perform(StartThreadOn.on(contentSelector, "verify core engine", text));
    await publishReview(page, "TestUser", await clientKey(page));
    await waitForReload(page);
    const card = inlineCards(page).filter({ hasText: text });
    await expect(card).toBeVisible();
    return card;
  }

  test("Automatic is the default when the site has a pattern; a bad custom link is refused, a good one is applied to the name", async ({ page }) => {
    await overrideSiteConfig(page, { profileUrl: PATTERN });
    createdProfile = await ensureAuthorProfile(page);
    await page.reload();
    await page.waitForSelector("threads-identity", { state: "attached" });
    await setAuthor(page, "TestUser");
    let card = await publishOwnComment(page, "Comment of a person who sets a link");
    // The site's pattern applies until the person chooses otherwise
    await expect(card.locator('a[part~="author"]').first()).toHaveAttribute("href", "https://github.com/testuser");

    // With the site's pattern set, Automatic is offered and is what an author with no setting has
    await saveProfileLink(page, async (group) => {
      await expect(group.getByRole("radio")).toHaveCount(3);
      await group.getByRole("radio", { name: "Custom link" }).check();
      await page.locator("threads-identity").getByRole("textbox", { name: "Custom link" }).fill("ftp://example.com/me");
    });
    await expect(page.getByTestId("identity-error")).toHaveText("Enter a link that starts with http:// or https://");

    // A good one: the panel closes, and the next load of the page links the name there
    await page.locator("threads-identity").getByRole("textbox", { name: "Custom link" }).fill("https://example.com/me");
    await page.locator("threads-identity").getByRole("button", { name: "Save" }).click();
    await expect(page.locator("threads-identity").getByRole("group", { name: "Profile link" })).toBeHidden();
    card = inlineCards(page).filter({ hasText: "Comment of a person who sets a link" });
    await expect(card.locator('a[part~="author"]').first()).toHaveAttribute("href", "https://example.com/me");
  });

  test("without a site pattern only Custom link and No link are offered", async ({ page }) => {
    await page.reload();
    await page.waitForSelector("threads-identity", { state: "attached" });
    const identity = page.locator("threads-identity");
    await identity.getByRole("button", { name: "Discussion identity" }).click();
    const group = identity.getByRole("group", { name: "Profile link" });
    await expect(group.getByRole("radio")).toHaveCount(2);
    await expect(group.getByRole("radio", { name: "Automatic" })).toHaveCount(0);
    await expect(group.getByRole("radio", { name: "No link" })).toBeChecked();
  });

  test("No link turns the name into plain text everywhere", async ({ page }) => {
    await overrideSiteConfig(page, { profileUrl: PATTERN });
    createdProfile = await ensureAuthorProfile(page);
    await page.reload();
    await page.waitForSelector("threads-identity", { state: "attached" });
    await setAuthor(page, "TestUser");
    let card = await publishOwnComment(page, "Comment of a person who turns linking off");
    await expect(card.locator('a[part~="author"]').first()).toBeVisible();

    await saveProfileLink(page, async (group) => {
      await group.getByRole("radio", { name: "No link" }).check();
    });
    await expect(page.locator("threads-identity").getByRole("group", { name: "Profile link" })).toBeHidden();
    card = inlineCards(page).filter({ hasText: "Comment of a person who turns linking off" });
    await expect(card.locator('[part~="author"]').first()).toHaveText("TestUser");
    await expect(card.locator('a[part~="author"]')).toHaveCount(0);
    // The sidebar's copy shows the same
    await openPanel(page);
    await expect(page.locator("threads-panel").locator('a[part~="author"]')).toHaveCount(0);
  });
});
