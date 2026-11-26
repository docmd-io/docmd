/**
 * Emoji reaction tests - adapted from old reactions.e2e.spec.ts.
 *
 * Changes from old plugin:
 * - Reactions stored in markdown (not SQLite), each reactor as an identity key plus a display name
 * - Server-rendered reactions in the .threads-reactions block (the view without JavaScript)
 * - Client-side reactions via the `threads-reactions` component inside each comment: chips, a quick row, the
 *   + picker for any emoji (unless the site restricts reactions), a card listing who reacted
 * - Toggle via docmd.call('threads:toggle-reaction'), which drafts the change in the
 *   caller's journal: the caller sees it at once, others and the server render only
 *   after threads:publish-review
 *
 * NOTE: Each docmd.call() that modifies the markdown file triggers a hot-reload
 * via the dev server's file watcher. We must waitForReload() between calls to
 * avoid "execution context destroyed" errors.
 */

import { test, expect } from "@playwright/test";
import { Actor } from "./screenplay.ts";
import { cleanThreads, inlineCard, overrideSiteConfig, publishReview, setAuthor, seedAndReload, waitForReload } from "./helpers.ts";
import type { Locator, Page } from "@playwright/test";

const ANCHOR = { quote: "verify core engine" };

let user: Actor;

test.beforeEach(async ({ page }) => {
  user = new Actor("TestUser", page);
  await page.goto("/");
  await page.waitForSelector("threads-app", { state: "attached", timeout: 10_000 });
  await setAuthor(page, "TestUser");
  await cleanThreads(page);
  await waitForReload(page);
});

test.describe("emoji reactions API", () => {
  test("adding a reaction persists it", async () => {
    const { id: threadId, comments } = await seedAndReload(user.page, {
      body: "Comment for reaction test",
    });

    const commentId = comments[0].id;

    // Toggle a reaction via API
    const reactions = await user.page.evaluate(
      async ({ threadId, commentId }) => {
        const file = document.body.dataset["sourceFile"];
        return docmd.call("threads:toggle-reaction", {
          file,
          threadId,
          commentId,
          emoji: "\ud83d\udc4d",
          author: "TestUser",
        });
      },
      { threadId, commentId },
    );

    expect(reactions).toBeTruthy();
    expect(reactions.length).toBe(1);
    expect(reactions[0].emoji).toBe("\ud83d\udc4d");
    expect(reactions[0].reactors.map((r: any) => r.name)).toContain("TestUser");
  });

  test("toggling same reaction removes it", async () => {
    const { id: threadId, comments } = await seedAndReload(user.page, {
      body: "Comment for toggle test",
    });

    const commentId = comments[0].id;

    // Add reaction
    await user.page.evaluate(
      async ({ threadId, commentId }) => {
        const file = document.body.dataset["sourceFile"];
        await docmd.call("threads:toggle-reaction", {
          file,
          threadId,
          commentId,
          emoji: "\ud83d\udc4d",
          author: "TestUser",
        });
      },
      { threadId, commentId },
    );

    // Wait for hot-reload after file write
    await waitForReload(user.page);

    // Toggle it off
    const reactions = await user.page.evaluate(
      async ({ threadId, commentId }) => {
        const file = document.body.dataset["sourceFile"];
        return docmd.call("threads:toggle-reaction", {
          file,
          threadId,
          commentId,
          emoji: "\ud83d\udc4d",
          author: "TestUser",
        });
      },
      { threadId, commentId },
    );

    // Reaction should be removed
    const thumbsReaction = reactions.find((r: any) => r.emoji === "\ud83d\udc4d");
    expect(thumbsReaction).toBeFalsy();
  });

  test("multiple reactions on same comment", async () => {
    const { id: threadId, comments } = await seedAndReload(user.page, {
      body: "Comment for multi-reaction test",
    });

    const commentId = comments[0].id;

    // Add thumbs up
    await user.page.evaluate(
      async ({ threadId, commentId }) => {
        const file = document.body.dataset["sourceFile"];
        await docmd.call("threads:toggle-reaction", {
          file,
          threadId,
          commentId,
          emoji: "\ud83d\udc4d",
          author: "TestUser",
        });
      },
      { threadId, commentId },
    );

    // Wait for hot-reload
    await waitForReload(user.page);

    // Add party
    const reactions = await user.page.evaluate(
      async ({ threadId, commentId }) => {
        const file = document.body.dataset["sourceFile"];
        return docmd.call("threads:toggle-reaction", {
          file,
          threadId,
          commentId,
          emoji: "\ud83c\udf89",
          author: "TestUser",
        });
      },
      { threadId, commentId },
    );

    expect(reactions.length).toBe(2);
    expect(reactions.find((r: any) => r.emoji === "\ud83d\udc4d")).toBeTruthy();
    expect(reactions.find((r: any) => r.emoji === "\ud83c\udf89")).toBeTruthy();
  });

  test("reactions persist after re-fetching threads", async () => {
    const { id: threadId, comments } = await seedAndReload(user.page, {
      body: "Comment for persistence test",
    });

    const commentId = comments[0].id;

    // Add reaction
    await user.page.evaluate(
      async ({ threadId, commentId }) => {
        const file = document.body.dataset["sourceFile"];
        await docmd.call("threads:toggle-reaction", {
          file,
          threadId,
          commentId,
          emoji: "\ud83d\udc4d",
          author: "TestUser",
        });
      },
      { threadId, commentId },
    );

    // Wait for hot-reload
    await waitForReload(user.page);

    // Re-fetch threads as the caller: their drafted reaction is part of their view
    const threads = await user.page.evaluate(async () => {
      const file = document.body.dataset["sourceFile"];
      return docmd.call("threads:get-threads", { file, author: "TestUser" });
    });

    const thread = threads.find((t: any) => t.id === threadId);
    expect(thread).toBeTruthy();

    const comment = thread.comments[0];
    expect(comment.reactions).toBeTruthy();
    expect(comment.reactions.length).toBe(1);
    expect(comment.reactions[0].emoji).toBe("\ud83d\udc4d");
    expect(comment.reactions[0].reactors.map((r: any) => r.name)).toContain("TestUser");
  });

  test("multiple authors on same reaction", async () => {
    const { id: threadId, comments } = await seedAndReload(user.page, {
      body: "Comment for multi-author test",
    });

    const commentId = comments[0].id;

    // TestUser adds thumbs up
    await user.page.evaluate(
      async ({ threadId, commentId }) => {
        const file = document.body.dataset["sourceFile"];
        await docmd.call("threads:toggle-reaction", {
          file,
          threadId,
          commentId,
          emoji: "\ud83d\udc4d",
          author: "TestUser",
        });
      },
      { threadId, commentId },
    );

    // Publish TestUser's reaction: Alice sees only published reactions and her own drafts
    await publishReview(user.page, "TestUser");
    await waitForReload(user.page);

    // Alice adds thumbs up
    const reactions = await user.page.evaluate(
      async ({ threadId, commentId }) => {
        const file = document.body.dataset["sourceFile"];
        return docmd.call("threads:toggle-reaction", {
          file,
          threadId,
          commentId,
          emoji: "\ud83d\udc4d",
          author: "Alice",
        });
      },
      { threadId, commentId },
    );

    const thumbs = reactions.find((r: any) => r.emoji === "\ud83d\udc4d");
    expect(thumbs).toBeTruthy();
    // A reaction stores each person's identity key and display name
    const names = thumbs.reactors.map((r: any) => r.name);
    expect(names).toContain("TestUser");
    expect(names).toContain("Alice");
    expect(names.length).toBe(2);
    expect(thumbs.reactors.every((r: any) => typeof r.key === "string")).toBe(true);
  });
});

test.describe("server-rendered reactions", () => {
  test("reactions block rendered in server HTML when reactions exist", async () => {
    // Seed a thread with a reaction, then reload to see server rendering
    const { id: threadId, comments } = await seedAndReload(user.page, {
      body: "Comment with reaction",
      anchor: ANCHOR,
    });

    const commentId = comments[0].id;

    // Add reaction
    await user.page.evaluate(
      async ({ threadId, commentId }) => {
        const file = document.body.dataset["sourceFile"];
        await docmd.call("threads:toggle-reaction", {
          file,
          threadId,
          commentId,
          emoji: "\ud83d\udc4d",
          author: "TestUser",
        });
      },
      { threadId, commentId },
    );

    // The server renders published reactions only: publish, then reload to see the HTML
    await publishReview(user.page, "TestUser");
    await waitForReload(user.page);

    // The component shows it as a pressed chip for the viewer who reacted...
    await expect(inlineCard(user.page, threadId).getByRole("button", { name: /\ud83d\udc4d 1: TestUser/ })).toBeVisible();
    // ...and the build's own markup, the view without JavaScript, has the block
    const raw = user.page.locator(`.threads-sidebar .threads-thread[data-thread-id="${threadId}"] .threads-reactions`);
    await expect(raw).toContainText("\ud83d\udc4d");
  });
});

// ---------------------------------------------------------------------------
// The reactions UI
// ---------------------------------------------------------------------------

const THUMBS = "\ud83d\udc4d";
const PARTY = "\ud83c\udf89";
const UNICORN = "\ud83e\udd84";

/** A reaction chip of the first comment of a card. */
const chipOf = (card: Locator, emoji: string): Locator => card.locator(`threads-button[part~="chip"][data-emoji="${emoji}"]`).first();
const chipButton = (card: Locator, emoji: string): Locator => chipOf(card, emoji).getByRole("button");
const addReaction = (card: Locator): Locator => card.getByRole("button", { name: "Add reaction" }).first();
const quickRow = (page: Page): Locator => page.getByRole("group", { name: "Choose a reaction" });

/** Open the quick row of a card's first comment and pick an emoji from it. */
async function reactWithQuickRow(page: Page, card: Locator, emoji: string): Promise<void> {
  await addReaction(card).click();
  // The emoji is slotted text of the `threads-button` host
  await quickRow(page).locator('threads-button[part~="option"]').filter({ hasText: emoji }).click();
}

/** Seed a thread with an anchor (so it has an inline card) and wait for its card. */
async function seedCard(page: Page, body: string): Promise<{ id: string; commentId: string; card: Locator }> {
  const { id, comments } = await seedAndReload(page, { body, anchor: ANCHOR });
  const card = inlineCard(page, id);
  await expect(card).toBeVisible({ timeout: 5_000 });
  return { id, commentId: comments[0]!.id, card };
}

/** Another person's published reaction, through the actions API. */
async function reactAs(page: Page, ids: { threadId: string; commentId: string }, emoji: string, author: string, authorKey: string): Promise<void> {
  await page.evaluate(
    async ({ threadId, commentId, emoji, author, authorKey }) => {
      await docmd.call("threads:toggle-reaction", { file: document.body.dataset["sourceFile"], threadId, commentId, emoji, author, authorKey });
    },
    { ...ids, emoji, author, authorKey },
  );
  await publishReview(page, author, authorKey);
  await waitForReload(page);
}

test.describe("reactions UI", () => {
  test("a quick-row emoji adds a pressed chip with a count; clicking the chip takes it back", async () => {
    const { card } = await seedCard(user.page, "Comment for the quick row");
    await expect(card.locator('threads-button[part~="chip"]')).toHaveCount(0);

    await reactWithQuickRow(user.page, card, THUMBS);
    await expect(chipButton(card, THUMBS)).toHaveAttribute("aria-pressed", "true");
    await expect(chipOf(card, THUMBS).locator('[part~="chip-count"]')).toHaveText("1");
    await expect(card.getByRole("button", { name: `${THUMBS} 1: TestUser` })).toBeVisible();
    // The quick row closes after a pick
    await expect(quickRow(user.page)).toBeHidden();

    // The chip itself is the toggle
    await chipButton(card, THUMBS).click();
    await expect(card.locator('threads-button[part~="chip"]')).toHaveCount(0);

    // And back on, from the chip of an emoji that is already there
    await reactWithQuickRow(user.page, card, PARTY);
    await expect(chipButton(card, PARTY)).toHaveAttribute("aria-pressed", "true");
  });

  test("the reaction is kept after a reload and is the same on the sidebar's copy of the card", async () => {
    const { id, card } = await seedCard(user.page, "Comment for persistence");
    await reactWithQuickRow(user.page, card, THUMBS);
    await expect(chipButton(card, THUMBS)).toHaveAttribute("aria-pressed", "true");

    await waitForReload(user.page);
    await expect(chipButton(inlineCard(user.page, id), THUMBS)).toHaveAttribute("aria-pressed", "true");
    // The panel's copy follows the inline one
    await expect(user.page.locator(`threads-panel threads-thread[data-thread-id="${id}"] threads-button[part~="chip"][data-emoji="${THUMBS}"]`)).toHaveCount(1);
  });

  test("another person's chip counts up when the viewer adds the same emoji and down when they take it back", async () => {
    const { id, commentId } = await seedCard(user.page, "Comment with someone else's reaction");
    await reactAs(user.page, { threadId: id, commentId }, THUMBS, "Alice", "alice");
    const card = inlineCard(user.page, id);

    await expect(chipOf(card, THUMBS).locator('[part~="chip-count"]')).toHaveText("1");
    await expect(chipButton(card, THUMBS)).toHaveAttribute("aria-pressed", "false");

    await chipButton(card, THUMBS).click();
    await expect(chipOf(card, THUMBS).locator('[part~="chip-count"]')).toHaveText("2");
    await expect(chipButton(card, THUMBS)).toHaveAttribute("aria-pressed", "true");

    await chipButton(card, THUMBS).click();
    await expect(chipOf(card, THUMBS).locator('[part~="chip-count"]')).toHaveText("1");
    await expect(chipButton(card, THUMBS)).toHaveAttribute("aria-pressed", "false");
  });

  test("the + picker reacts with any emoji; the picker code is fetched on the first + click only", async () => {
    const { card } = await seedCard(user.page, "Comment for the picker");
    const requests: string[] = [];
    user.page.on("request", (r) => {
      if (/emoji/.test(new URL(r.url()).pathname)) requests.push(new URL(r.url()).pathname);
    });

    // Unrestricted by default: the quick row has the eight and a + (More emoji) after them
    await addReaction(card).click();
    await expect(quickRow(user.page).getByRole("button")).toHaveCount(9);
    await expect(quickRow(user.page).getByRole("button", { name: "More emoji" })).toBeVisible();
    expect(requests).toEqual([]);

    await quickRow(user.page).getByRole("button", { name: "More emoji" }).click();
    await user.page.getByRole("combobox", { name: "Search" }).fill("unicorn");
    await user.page.getByRole("option", { name: /unicorn/ }).first().click();

    await expect(chipButton(card, UNICORN)).toHaveAttribute("aria-pressed", "true");
    await expect(chipOf(card, UNICORN).locator('[part~="chip-count"]')).toHaveText("1");
    expect(requests.some((path) => path.endsWith("emoji-picker.js"))).toBe(true);
    expect(requests.some((path) => /\/emoji\/en\.json$/.test(path))).toBe(true);

    // A second open reuses what was loaded
    const before = requests.length;
    await addReaction(card).click();
    await quickRow(user.page).getByRole("button", { name: "More emoji" }).click();
    await expect(user.page.getByRole("combobox", { name: "Search" })).toBeVisible();
    expect(requests.length).toBe(before);
  });

  test("a person's picker emoji can get a +1 from the viewer", async () => {
    const { id, commentId } = await seedCard(user.page, "Comment with a picker-only emoji");
    await reactAs(user.page, { threadId: id, commentId }, UNICORN, "Alice", "alice");
    const card = inlineCard(user.page, id);

    await expect(chipOf(card, UNICORN).locator('[part~="chip-count"]')).toHaveText("1");
    await chipButton(card, UNICORN).click();
    await expect(chipOf(card, UNICORN).locator('[part~="chip-count"]')).toHaveText("2");
    await expect(chipButton(card, UNICORN)).toHaveAttribute("aria-pressed", "true");
  });

  test("a restricted site offers only the listed emoji, has no +, and locks chips of other emoji", async () => {
    // Someone's unlisted emoji, published while the site is unrestricted
    const { id, commentId } = await seedCard(user.page, "Comment on a restricted site");
    await reactAs(user.page, { threadId: id, commentId }, UNICORN, "Alice", "alice");
    await overrideSiteConfig(user.page, { reactions: { emoji: [THUMBS, "\u2764\ufe0f"], restricted: true } });
    await user.page.reload();
    const card = inlineCard(user.page, id);
    await expect(card).toBeVisible({ timeout: 10_000 });

    await addReaction(card).click();
    await expect(quickRow(user.page).getByRole("button")).toHaveCount(2);
    await expect(quickRow(user.page).getByRole("button", { name: "More emoji" })).toHaveCount(0);
    await user.page.keyboard.press("Escape");

    // The chip of an unlisted emoji is there but cannot be toggled
    await expect(chipButton(card, UNICORN)).toBeDisabled();
    // A listed emoji still works
    await reactWithQuickRow(user.page, card, THUMBS);
    await expect(chipButton(card, THUMBS)).toHaveAttribute("aria-pressed", "true");
  });

  test("hovering a chip lists who reacted by name, linked to their profile, never by key", async () => {
    const { id, commentId } = await seedCard(user.page, "Comment for the who-reacted card");
    await reactAs(user.page, { threadId: id, commentId }, THUMBS, "Alice", "gh-alice-42");
    await overrideSiteConfig(user.page, { profileUrl: "https://github.com/{id}" });
    await user.page.reload();
    const card = inlineCard(user.page, id);
    await expect(card).toBeVisible({ timeout: 10_000 });

    await chipButton(card, THUMBS).hover();
    const who = card.getByRole("tooltip");
    await expect(who).toBeVisible();
    await expect(who).toHaveText("Alice");
    const link = who.getByRole("link", { name: "Alice" });
    await expect(link).toHaveAttribute("href", "https://github.com/gh-alice-42");
    await expect(link).toHaveAttribute("rel", /nofollow/);
    await expect(who).not.toContainText("gh-alice-42");
  });
});
