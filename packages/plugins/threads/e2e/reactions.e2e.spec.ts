/**
 * Emoji reaction tests - adapted from old reactions.e2e.spec.ts.
 *
 * Changes from old plugin:
 * - Reactions stored in markdown (not SQLite)
 * - Server-rendered reactions in .threads-reactions block
 * - Client-side reactions via threads-comment Lit component (tc-* classes)
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
import { cleanThreads, publishReview, setAuthor, seedAndReload, waitForReload } from "./helpers.ts";

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
    expect(reactions[0].authors).toContain("TestUser");
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
    expect(comment.reactions[0].authors).toContain("TestUser");
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
    expect(thumbs.authors).toContain("TestUser");
    expect(thumbs.authors).toContain("Alice");
    expect(thumbs.authors.length).toBe(2);
  });
});

test.describe("server-rendered reactions", () => {
  test("reactions block rendered in server HTML when reactions exist", async () => {
    // Seed a thread with a reaction, then reload to see server rendering
    const { id: threadId, comments } = await seedAndReload(user.page, {
      body: "Comment with reaction",
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

    const thread = user.page.locator(`.threads-thread[data-thread-id="${threadId}"]`);
    const reactionsBlock = thread.locator(".threads-reactions");

    await expect(reactionsBlock).toContainText("\ud83d\udc4d");
  });
});
