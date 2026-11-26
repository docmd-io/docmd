/**
 * Thread resolve/unresolve tests - adapted from old devtalk.e2e.spec.ts
 * "thread behavior" block.
 *
 * Changes from old plugin:
 * - Resolve functionality exists at API level (threads:resolve-thread); it drafts the
 *   toggle in the caller's journal until threads:publish-review writes it
 * - Resolved threads get .threads-thread--resolved class (opacity: 0.55)
 * - The Lit-rendered threads-thread component has Resolve/Unresolve buttons,
 *   but the current inline mode uses server-rendered HTML
 */

import { test, expect } from "@playwright/test";
import { Actor } from "./screenplay.ts";
import { cleanThreads, setAuthor, seedAndReload, waitForReload } from "./helpers.ts";

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

  test("resolved thread gets --resolved CSS class on server render", async () => {
    const { id: threadId } = await seedAndReload(user.page, {
      body: "Thread for CSS test",
      resolved: true,
    });

    // The resolved state requires an extra reload since seedThread does
    // add-thread + resolve as separate file writes
    await waitForReload(user.page);

    const threadEl = user.page.locator(`.threads-thread[data-thread-id="${threadId}"]`);
    await expect(threadEl).toBeAttached({ timeout: 5_000 });

    // Server-rendered resolved threads should have the resolved class
    const hasResolvedClass = await threadEl.evaluate((el) =>
      el.classList.contains("threads-thread--resolved"),
    );
    expect(hasResolvedClass).toBe(true);
  });
});
