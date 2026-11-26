/**
 * Editing a comment: Edit is offered on the viewer's own comments only, saving shows the comment as an
 * unpublished change (and as "edited" once published), and the edit survives a reload.
 */

import { test, expect } from "@playwright/test";
import { cleanThreads, emptyOpenReview, inlineCard, publishReview, seedAndReload, setAuthor, waitForReload } from "./helpers.ts";

const ANCHOR = { quote: "verify core engine" };

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

const edit = (card: ReturnType<typeof inlineCard>) => card.getByRole("button", { name: "Edit comment" });

test("Edit shows on the viewer's own comment and not on someone else's", async ({ page }) => {
  const own = await seedAndReload(page, { body: "My own comment", anchor: ANCHOR });
  const card = inlineCard(page, own.id);
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(edit(card)).toHaveCount(1);

  await cleanThreads(page);
  const other = await seedAndReload(page, { author: "OtherPerson", body: "Their comment", anchor: ANCHOR });
  const theirs = inlineCard(page, other.id);
  await expect(theirs).toBeVisible({ timeout: 10_000 });
  await expect(theirs.getByRole("button", { name: "Reply" }).first()).toBeVisible();
  await expect(edit(theirs)).toHaveCount(0);
});

test("saving an edit shows the new text as an unpublished change, and it survives a reload", async ({ page }) => {
  const { id } = await seedAndReload(page, { body: "Text before the edit", anchor: ANCHOR });
  const card = inlineCard(page, id);
  await expect(card).toBeVisible({ timeout: 10_000 });

  await edit(card).click();
  const editor = card.locator("threads-editor");
  const textbox = editor.getByRole("textbox");
  await expect(textbox).toHaveValue("Text before the edit");
  await textbox.fill("Text after the edit");
  await editor.getByRole("button", { name: "Save" }).click();

  await expect(card.locator("threads-editor")).toHaveCount(0);
  await expect(card.locator('[part~="body"]').first()).toContainText("Text after the edit");
  await expect(card.locator('[part~="draft"]').first()).toBeVisible();
  await expect(page.getByTestId("unpublished-marker")).toBeVisible();

  await page.reload();
  const again = inlineCard(page, id);
  await expect(again.locator('[part~="body"]').first()).toContainText("Text after the edit", { timeout: 10_000 });
  await expect(again.locator('[part~="draft"]').first()).toBeVisible();
});

test("Cancel leaves the comment as it was", async ({ page }) => {
  const { id } = await seedAndReload(page, { body: "Unchanged text", anchor: ANCHOR });
  const card = inlineCard(page, id);
  await expect(card).toBeVisible({ timeout: 10_000 });
  await edit(card).click();
  await card.locator("threads-editor").getByRole("textbox").fill("Discarded text");
  await card.locator("threads-editor").getByRole("button", { name: "Cancel" }).click();
  await expect(card.locator("threads-editor")).toHaveCount(0);
  await expect(card.locator('[part~="body"]').first()).toContainText("Unchanged text");
});

test("a published edit shows 'edited' and no unpublished marker on the comment", async ({ page }) => {
  const { id } = await seedAndReload(page, { body: "First wording", anchor: ANCHOR });
  const card = inlineCard(page, id);
  await expect(card).toBeVisible({ timeout: 10_000 });
  await edit(card).click();
  await card.locator("threads-editor").getByRole("textbox").fill("Second wording");
  await card.locator("threads-editor").getByRole("button", { name: "Save" }).click();
  await expect(card.locator('[part~="draft"]').first()).toBeVisible();

  await publishReview(page, "TestUser", await page.evaluate(() => localStorage.getItem("threads_author_key") ?? "TestUser"));
  await waitForReload(page);
  const after = inlineCard(page, id);
  await expect(after.locator('[part~="body"]').first()).toContainText("Second wording", { timeout: 10_000 });
  await expect(after.locator('[part~="edited"]').first()).toBeVisible();
  await expect(after.locator('[part~="draft"]')).toHaveCount(0);
});
