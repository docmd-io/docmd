/**
 * Thread resolve/unresolve tests - adapted from old devtalk.e2e.spec.ts
 * "thread behavior" block.
 *
 * Changes from old plugin:
 * - Resolve functionality exists at API level (threads:resolve-thread); it drafts the
 *   toggle in the caller's journal until threads:publish-review writes it
 * - Resolved threads carry the `resolved` attribute on their `threads-thread` card
 *   (the build's own markup keeps `.threads-thread--resolved` for no-JS readers)
 * - The card has Resolve/Unresolve buttons, inline and in the panel
 */

import { test, expect } from "@playwright/test";
import { Actor } from "./screenplay.ts";
import { cleanThreads, inlineCard, openPanel, panelCard, setAuthor, seedAndReload, waitForReload } from "./helpers.ts";

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

test.describe("resolve thread API", () => {
  test("resolving a thread sets resolved state", async () => {
    const { id: threadId } = await seedAndReload(user.page, {
      body: "Thread to resolve",
    });

    // Resolve via API
    const resolved = await user.page.evaluate(
      async ({ threadId }) => {
        const file = document.body.dataset["sourceFile"];
        return docmd.call("threads:resolve-thread", {
          file,
          threadId,
          author: "TestUser",
          resolved_by: "TestUser",
        });
      },
      { threadId },
    );

    expect(resolved.resolved).toBeTruthy();

    // The resolve call wrote to the file, triggering hot-reload. Wait for it.
    await waitForReload(user.page);

    // Verify via re-fetch
    const threads = await user.page.evaluate(async () => {
      const file = document.body.dataset["sourceFile"];
      return docmd.call("threads:get-threads", { file, author: "TestUser" });
    });

    const thread = threads.find((t: any) => t.id === threadId);
    expect(thread.resolved).toBeTruthy();
  });

  test("unresolving a thread toggles back to open", async () => {
    // Seed a resolved thread
    const { id: threadId } = await seedAndReload(user.page, {
      body: "Resolved thread for unresolve test",
      resolved: true,
    });

    // Unresolve by calling resolve-thread again (it toggles)
    const unresolved = await user.page.evaluate(
      async ({ threadId }) => {
        const file = document.body.dataset["sourceFile"];
        return docmd.call("threads:resolve-thread", {
          file,
          threadId,
          author: "TestUser",
          resolved_by: "TestUser",
        });
      },
      { threadId },
    );

    expect(unresolved.resolved).toBeFalsy();
  });

  test("a resolved thread's card is marked resolved, inline and in the panel", async () => {
    const { id: threadId } = await seedAndReload(user.page, {
      body: "Thread for CSS test",
      anchor: ANCHOR,
      resolved: true,
    });

    // The resolved state requires an extra reload since seedThread does
    // add-thread + resolve as separate file writes
    await waitForReload(user.page);

    const card = inlineCard(user.page, threadId);
    await expect(card).toBeVisible({ timeout: 5_000 });
    await expect(card).toHaveAttribute("resolved", "");
    await expect(card.getByText("Resolved", { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "Unresolve", exact: true })).toBeVisible();

    await openPanel(user.page);
    await expect(panelCard(user.page, threadId)).toHaveAttribute("resolved", "");
  });
});

test.describe("resolve thread UI", () => {
  test("Resolve and Unresolve on the card toggle the thread", async () => {
    const { id: threadId } = await seedAndReload(user.page, { body: "Thread to resolve in the UI", anchor: ANCHOR });
    const card = inlineCard(user.page, threadId);
    await expect(card).toBeVisible({ timeout: 5_000 });
    await expect(card).not.toHaveAttribute("resolved", "");

    await card.getByRole("button", { name: "Resolve", exact: true }).click();
    await expect(card).toHaveAttribute("resolved", "");
    await expect(card.getByRole("button", { name: "Unresolve", exact: true })).toBeVisible();

    await card.getByRole("button", { name: "Unresolve", exact: true }).click();
    await expect(card).not.toHaveAttribute("resolved", "");
    await expect(card.getByRole("button", { name: "Resolve", exact: true })).toBeVisible();
  });

  test("a failed resolve shows an error line on the card and leaves the thread open", async () => {
    const { id: threadId } = await seedAndReload(user.page, { body: "Thread whose resolve fails", anchor: ANCHOR });
    const card = inlineCard(user.page, threadId);
    await expect(card).toBeVisible({ timeout: 5_000 });

    // Make the action fail, as a server error would
    await user.page.evaluate(() => {
      const original = docmd.call.bind(docmd);
      docmd.call = (action: string, ...rest: unknown[]) =>
        action === "threads:resolve-thread" ? Promise.reject(new Error("e2e: resolve refused")) : original(action, ...(rest as [Record<string, unknown>]));
    });

    await card.getByRole("button", { name: "Resolve", exact: true }).click();
    await expect(card.getByRole("alert")).toHaveText("Could not save. Try again.");
    await expect(card).not.toHaveAttribute("resolved", "");
    await expect(card.getByRole("button", { name: "Resolve", exact: true })).toBeEnabled();
  });
});
