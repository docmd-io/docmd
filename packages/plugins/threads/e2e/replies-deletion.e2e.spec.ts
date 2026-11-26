/**
 * Reply and deletion tests - adapted from old editing-deletion.e2e.spec.ts
 * and devtalk.e2e.spec.ts "discussions" block.
 *
 * Changes from old plugin:
 * - Reply button on each comment (not an always-visible reply textarea)
 * - Delete confirmation via a `threads-dialog` (role dialog, "Confirm Delete")
 * - Seeding via docmd.call() instead of HTTP API
 * - Comment editing is handled by the `threads-comment` component (see edit-comment.e2e.spec.ts)
 * - Replies, edits and deletions are drafts in the caller's journal until published:
 *   these specs check the caller's view (threads:get-threads with their identity)
 */

import { test, expect } from "@playwright/test";
import {
  Actor,
  ReplyToThread,
} from "./screenplay.ts";
import { clientKey, cleanThreads, inlineCard, openPanel, panelCard, setAuthor, seedAndReload, waitForReload, waitForClientProcessing } from "./helpers.ts";

let user: Actor;

test.beforeEach(async ({ page }) => {
  user = new Actor("TestUser", page);
  await page.goto("/");
  await page.waitForSelector("threads-app", { state: "attached", timeout: 10_000 });
  await setAuthor(page, "TestUser");
  await cleanThreads(page);
  await waitForReload(page);
});

// ---------------------------------------------------------------------------
// Reply to thread
// ---------------------------------------------------------------------------

test.describe("reply to thread", () => {
  test("clicking Reply opens inline editor inside thread card", async () => {
    // Use an anchored thread so it gets a card inline (unanchored threads
    // only have their card in the sidebar panel)
    const { id: threadId } = await seedAndReload(user.page, {
      body: "Thread for reply test",
      anchor: { quote: "verify core engine" },
    });

    await waitForClientProcessing(user.page);

    const threadEl = inlineCard(user.page, threadId);
    await expect(threadEl).toBeVisible({ timeout: 5_000 });

    const replyBtn = threadEl.getByRole("button", { name: "Reply", exact: true }).first();
    await expect(replyBtn).toBeVisible({ timeout: 5_000 });
    await replyBtn.click();

    // The editor is inside the card, under the comment, and takes the focus
    const editor = threadEl.locator("threads-editor");
    await expect(editor).toBeVisible({ timeout: 5_000 });
    await expect(editor.getByRole("textbox")).toBeFocused();
    await expect(user.page.locator("threads-editor")).toHaveCount(1);
  });

  test("submitting reply adds a comment to the thread", async () => {
    // Use anchored thread so it's visible inline
    const { id: threadId } = await seedAndReload(user.page, {
      body: "Thread for reply submission",
      anchor: { quote: "verify core engine" },
    });

    await waitForClientProcessing(user.page);

    const threadSelector = `threads-thread[variant="inline"][data-thread-id="${threadId}"]`;

    await user.perform(
      ReplyToThread.on(threadSelector, "I agree with this"),
    );

    // Wait for reload after the reply is submitted
    await waitForReload(user.page);

    // Verify the reply is in the caller's view (the client drafts under its stored key)
    const authorKey = await clientKey(user.page);
    const threads = await user.page.evaluate(async (authorKey) => {
      const file = document.body.dataset["sourceFile"];
      return docmd.call("threads:get-threads", { file, author: "TestUser", authorKey });
    }, authorKey);

    const thread = threads.find((t: any) => t.id === threadId);
    expect(thread).toBeTruthy();
    expect(thread.comments.length).toBe(2);
    expect(thread.comments[1].body).toBe("I agree with this");
  });
});

// ---------------------------------------------------------------------------
// Thread deletion
// ---------------------------------------------------------------------------

test.describe("thread deletion", () => {
  test("Delete on a lone comment asks first; Cancel keeps the thread", async () => {
    const { id: threadId } = await seedAndReload(user.page, {
      body: "Thread to delete",
      anchor: { quote: "verify core engine" },
    });

    const threadEl = inlineCard(user.page, threadId);
    await expect(threadEl).toBeVisible({ timeout: 5_000 });
    await expect(user.page.getByRole("dialog")).toBeHidden();

    await threadEl.getByRole("button", { name: "Delete comment" }).click();
    const dialog = user.page.getByRole("dialog", { name: "Confirm Delete" });
    await expect(dialog).toBeVisible();
    // The question is slotted text of the `threads-dialog` host
    await expect(user.page.locator("threads-app > threads-dialog")).toContainText("Are you sure you want to delete this thread?");

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(threadEl).toBeVisible();
  });

  test("confirming Delete in the dialog removes the thread and its highlight", async () => {
    const { id: threadId } = await seedAndReload(user.page, {
      body: "Thread to delete in the UI",
      anchor: { quote: "verify core engine" },
    });

    const threadEl = inlineCard(user.page, threadId);
    await expect(threadEl).toBeVisible({ timeout: 5_000 });
    await threadEl.getByRole("button", { name: "Delete comment" }).click();
    await user.page.getByRole("dialog", { name: "Confirm Delete" }).getByRole("button", { name: "Delete", exact: true }).click();

    await expect(threadEl).toHaveCount(0);
    await expect(user.page.locator(`mark.threads-highlight[data-thread-id="${threadId}"]`)).toHaveCount(0);
  });

  test("a failed delete keeps the dialog open with an error and keeps the thread", async () => {
    const { id: threadId } = await seedAndReload(user.page, {
      body: "Thread whose delete fails",
      anchor: { quote: "verify core engine" },
    });
    const threadEl = inlineCard(user.page, threadId);
    await expect(threadEl).toBeVisible({ timeout: 5_000 });

    await user.page.evaluate(() => {
      const original = docmd.call.bind(docmd);
      docmd.call = (action: string, ...rest: unknown[]) =>
        action === "threads:delete-thread" ? Promise.reject(new Error("e2e: delete refused")) : original(action, ...(rest as [Record<string, unknown>]));
    });

    await threadEl.getByRole("button", { name: "Delete comment" }).click();
    const dialog = user.page.getByRole("dialog", { name: "Confirm Delete" });
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Could not save. Try again.");
    await expect(dialog.getByRole("button", { name: "Delete", exact: true })).toBeEnabled();
    await expect(threadEl).toHaveCount(1);
    await expect(user.page.locator(`mark.threads-highlight[data-thread-id="${threadId}"]`).first()).toBeAttached();
  });

  test("confirm delete removes thread via API", async () => {
    const { id: threadId } = await seedAndReload(user.page, {
      body: "Thread to delete via API",
    });

    // Delete via WebSocket API
    await user.page.evaluate(
      async ({ threadId }) => {
        const file = document.body.dataset["sourceFile"];
        await docmd.call("threads:delete-thread", { file, threadId, author: "TestUser" });
      },
      { threadId },
    );

    // Reload: the draft lives on the server, in the caller's journal
    await waitForReload(user.page);

    // Verify deletion
    const threads = await user.page.evaluate(async () => {
      const file = document.body.dataset["sourceFile"];
      return docmd.call("threads:get-threads", { file, author: "TestUser" });
    });

    const deleted = threads.find((t: any) => t.id === threadId);
    expect(deleted).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Comment deletion
// ---------------------------------------------------------------------------

test.describe("comment deletion", () => {
  test("Delete is offered only on the viewer's own comments", async () => {
    // Seeded as Alice (the comment limit is per author, and the specs of this file share TestUser's minute)
    const { id: threadId } = await seedAndReload(user.page, {
      author: "Alice",
      body: "Alice's comment",
      anchor: { quote: "verify core engine" },
    });
    await waitForClientProcessing(user.page);

    // TestUser did not write it: no Delete
    const card = inlineCard(user.page, threadId);
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.locator("threads-comment")).toHaveCount(1);
    await expect(card.locator('[part~="delete"]')).toHaveCount(0);
    await openPanel(user.page);
    await expect(panelCard(user.page, threadId).locator('[part~="delete"]')).toHaveCount(0);

    // Under Alice's name, on the next load, it is hers to delete (the name matches without regard to case)
    await setAuthor(user.page, "alice");
    await user.page.reload({ waitUntil: "domcontentloaded" });
    await user.page.waitForSelector("threads-app", { state: "attached", timeout: 10_000 });
    await waitForClientProcessing(user.page);
    await expect(inlineCard(user.page, threadId).locator('[part~="delete"]')).toHaveCount(1, { timeout: 10_000 });
  });

  test("deleting a reply leaves the root comment intact", async () => {
    const { id: threadId, comments } = await seedAndReload(user.page, {
      body: "Root comment",
      replies: [{ body: "Reply to remove", author: "TestUser" }],
    });

    const replyId = comments[1].id;

    // Delete via API
    await user.page.evaluate(
      async ({ threadId, commentId }) => {
        const file = document.body.dataset["sourceFile"];
        await docmd.call("threads:delete-comment", { file, threadId, commentId, author: "TestUser" });
      },
      { threadId, commentId: replyId },
    );

    // Reload: the draft lives on the server, in the caller's journal
    await waitForReload(user.page);

    // Verify only root comment remains
    const threads = await user.page.evaluate(async () => {
      const file = document.body.dataset["sourceFile"];
      return docmd.call("threads:get-threads", { file, author: "TestUser" });
    });

    const thread = threads.find((t: any) => t.id === threadId);
    expect(thread).toBeTruthy();
    expect(thread.comments.length).toBe(1);
    expect(thread.comments[0].body).toBe("Root comment");
  });
});

// ---------------------------------------------------------------------------
// Comment editing
// ---------------------------------------------------------------------------

test.describe("comment editing", () => {
  test("editing a comment persists the change", async () => {
    const { id: threadId, comments } = await seedAndReload(user.page, {
      body: "Original body for edit test",
    });

    const commentId = comments[0].id;
    const newBody = "Edited comment body";

    // Edit via API
    await user.page.evaluate(
      async ({ threadId, commentId, newBody }) => {
        const file = document.body.dataset["sourceFile"];
        await docmd.call("threads:edit-comment", {
          file,
          threadId,
          commentId,
          body: newBody,
          author: "TestUser",
        });
      },
      { threadId, commentId, newBody },
    );

    // Reload: the draft lives on the server, in the caller's journal
    await waitForReload(user.page);

    // Verify edit persisted
    const threads = await user.page.evaluate(async () => {
      const file = document.body.dataset["sourceFile"];
      return docmd.call("threads:get-threads", { file, author: "TestUser" });
    });

    const thread = threads.find((t: any) => t.id === threadId);
    expect(thread.comments[0].body).toBe(newBody);
    expect(thread.comments[0].edited_at).toBeTruthy();
  });

  test("editing with empty body does nothing (guard)", async () => {
    const { id: threadId, comments } = await seedAndReload(user.page, {
      body: "Original content",
    });

    const commentId = comments[0].id;

    // Attempt to edit with empty body - the API should reject it or the guard should prevent it
    // An empty body is rejected by the server
    await expect(
      user.page.evaluate(
        async ({ threadId, commentId }) => {
          const file = document.body.dataset["sourceFile"];
          await docmd.call("threads:edit-comment", {
            file,
            threadId,
            commentId,
            body: "",
            author: "TestUser",
          });
        },
        { threadId, commentId },
      ),
    ).rejects.toThrow();

    // Verify original body unchanged
    const threads = await user.page.evaluate(async () => {
      const file = document.body.dataset["sourceFile"];
      return docmd.call("threads:get-threads", { file, author: "TestUser" });
    });

    const thread = threads.find((t: any) => t.id === threadId);
    expect(thread.comments[0].body).toBe("Original content");
  });
});
