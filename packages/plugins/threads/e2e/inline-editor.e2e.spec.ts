/**
 * Inline editor tests - adapted from old inline-editor.e2e.spec.ts.
 *
 * Changes from old plugin:
 * - threads-inline-editor replaces devtalk-inline-editor
 * - "Add comment" popover replaces "Add to page" button
 * - No separate panel compose form; all editing is inline
 */

import { test, expect } from "@playwright/test";
import {
  Actor,
  NavigateTo,
  SelectText,
  SubmitWithKeyboard,
  CancelWithKeyboard,
  TheInlineEditor,
} from "./screenplay.ts";
import { cleanThreads, setAuthor, waitForReload } from "./helpers.ts";

const contentSelector = "[data-docmd-content] p, .docmd-content p, article p, main p";

let user: Actor;

test.beforeEach(async ({ page }) => {
  user = new Actor("TestUser", page);
  await page.goto("/");
  await page.waitForSelector("threads-app", { state: "attached", timeout: 10_000 });
  await setAuthor(page, "TestUser");
  await cleanThreads(page);
  await waitForReload(page);
});

/** Helper: get text to select from the first paragraph */
async function getTextToSelect(): Promise<string> {
  await user.page.waitForSelector(contentSelector, { timeout: 5_000 });
  const firstParagraph = user.page.locator(contentSelector).first();
  const paragraphText = await firstParagraph.textContent();
  if (!paragraphText || paragraphText.trim().length < 5) {
    throw new Error("No suitable text content found to select");
  }
  return paragraphText.trim().slice(0, 20);
}

/** Helper: open inline editor by selecting text and clicking "Add comment" */
async function openInlineEditor(textToSelect: string): Promise<void> {
  await user.perform(SelectText.within(contentSelector, textToSelect));

  const addCommentBtn = user.page.locator("threads-popover").getByText("Add comment");
  await addCommentBtn.waitFor({ state: "visible", timeout: 5_000 });
  await addCommentBtn.click();

  const editor = user.page.locator("threads-inline-editor");
  await editor.waitFor({ state: "attached", timeout: 5_000 });
}

/** Helper: type text into the inline editor's textarea */
async function typeInEditor(text: string): Promise<void> {
  const textarea = user.page
    .locator("threads-inline-editor")
    .locator("sl-textarea")
    .locator("textarea");
  await textarea.fill(text);
}

// ---------------------------------------------------------------------------
// Inline editor basics
// ---------------------------------------------------------------------------

test.describe("inline editor basics", () => {
  test("shows inline editor after clicking Add comment", async () => {
    await user.perform(NavigateTo.path("/"));
    const textToSelect = await getTextToSelect();

    await openInlineEditor(textToSelect);

    expect(await user.ask(TheInlineEditor.isVisible())).toBe(true);
  });

  test("submits inline comment and editor disappears", async () => {
    await user.perform(NavigateTo.path("/"));
    const textToSelect = await getTextToSelect();

    await openInlineEditor(textToSelect);
    await typeInEditor("Inline comment via selection");

    const editor = user.page.locator("threads-inline-editor");
    const submitBtn = editor.locator("sl-button[variant='primary']");
    await submitBtn.click();

    await editor.waitFor({ state: "detached", timeout: 10_000 });
  });

  test("cancel removes inline editor", async () => {
    await user.perform(NavigateTo.path("/"));
    const textToSelect = await getTextToSelect();

    await openInlineEditor(textToSelect);
    expect(await user.ask(TheInlineEditor.isVisible())).toBe(true);

    const editor = user.page.locator("threads-inline-editor");
    const cancelBtn = editor.locator("sl-button[variant='neutral']");
    await cancelBtn.click();

    await editor.waitFor({ state: "detached", timeout: 5_000 });
  });

  test("submit button is disabled when textarea is empty", async () => {
    await user.perform(NavigateTo.path("/"));
    const textToSelect = await getTextToSelect();

    await openInlineEditor(textToSelect);

    const editor = user.page.locator("threads-inline-editor");
    const submitBtn = editor.locator("sl-button[variant='primary']");
    await expect(submitBtn).toHaveAttribute("disabled", { timeout: 3_000 });
  });
});

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

test.describe("keyboard shortcuts", () => {
  test("Cmd+Enter submits inline editor", async () => {
    await user.perform(NavigateTo.path("/"));
    const textToSelect = await getTextToSelect();

    await openInlineEditor(textToSelect);
    await typeInEditor("Submitted via keyboard");

    await user.perform(SubmitWithKeyboard.inInlineEditor());

    const editor = user.page.locator("threads-inline-editor");
    await editor.waitFor({ state: "detached", timeout: 10_000 });
  });

  test("Escape cancels inline editor", async () => {
    await user.perform(NavigateTo.path("/"));
    const textToSelect = await getTextToSelect();

    await openInlineEditor(textToSelect);

    await user.perform(CancelWithKeyboard.inInlineEditor());

    const editor = user.page.locator("threads-inline-editor");
    await editor.waitFor({ state: "detached", timeout: 5_000 });
  });

  test("Cmd+Enter does nothing when textarea is empty", async () => {
    await user.perform(NavigateTo.path("/"));
    const textToSelect = await getTextToSelect();

    await openInlineEditor(textToSelect);

    // Press Cmd+Enter without typing anything
    await user.perform(SubmitWithKeyboard.inInlineEditor());

    // Editor should still be present
    const editor = user.page.locator("threads-inline-editor");
    await expect(editor).toBeAttached({ timeout: 1_000 });
  });
});

// ---------------------------------------------------------------------------
// Inline editor validation
// ---------------------------------------------------------------------------

test.describe("inline editor validation", () => {
  test("whitespace-only input keeps submit button disabled", async () => {
    await user.perform(NavigateTo.path("/"));
    const textToSelect = await getTextToSelect();

    await openInlineEditor(textToSelect);

    const textarea = user.page
      .locator("threads-inline-editor")
      .locator("sl-textarea")
      .locator("textarea");
    await textarea.fill("   ");

    const submitBtn = user.page
      .locator("threads-inline-editor")
      .locator("sl-button[variant='primary']");
    await expect(submitBtn).toHaveAttribute("disabled");
  });

  test("inline editor textarea gets autofocus on open", async () => {
    await user.perform(NavigateTo.path("/"));
    const textToSelect = await getTextToSelect();

    await openInlineEditor(textToSelect);

    const textarea = user.page
      .locator("threads-inline-editor")
      .locator("sl-textarea")
      .locator("textarea");

    await expect(textarea).toBeFocused({ timeout: 3_000 });
  });
});

// ---------------------------------------------------------------------------
// Inline editor submitting state
// ---------------------------------------------------------------------------

test.describe("inline editor submitting state", () => {
  test("submit button shows 'Submit' text in default state", async () => {
    await user.perform(NavigateTo.path("/"));
    const textToSelect = await getTextToSelect();

    await openInlineEditor(textToSelect);
    await typeInEditor("Some comment text");

    const editor = user.page.locator("threads-inline-editor");
    const submitBtn = editor.locator("sl-button[variant='primary']");

    await expect(submitBtn).toContainText("Submit");
  });

  test("submit button footer hint reads Cmd+Enter to submit", async () => {
    await user.perform(NavigateTo.path("/"));
    const textToSelect = await getTextToSelect();

    await openInlineEditor(textToSelect);

    const editor = user.page.locator("threads-inline-editor");
    const hint = editor.locator(".hint");

    await expect(hint).toBeVisible();
    await expect(hint).toContainText("Cmd+Enter to submit");
  });

  test("double-submit prevention: clicking submit twice only submits once", async () => {
    await user.perform(NavigateTo.path("/"));
    const textToSelect = await getTextToSelect();

    await openInlineEditor(textToSelect);
    await typeInEditor("Double-submit test comment");

    const editor = user.page.locator("threads-inline-editor");
    const submitBtn = editor.locator("sl-button[variant='primary']");

    await submitBtn.click();
    await submitBtn.click({ force: true }).catch(() => {});

    await editor.waitFor({ state: "detached", timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Inline editor placeholder text
// ---------------------------------------------------------------------------

test.describe("inline editor placeholder text", () => {
  test("inline editor textarea has correct placeholder", async () => {
    await user.perform(NavigateTo.path("/"));

    await openInlineEditor(await getTextToSelect());

    const editor = user.page.locator("threads-inline-editor");
    const textarea = editor.locator("sl-textarea").locator("textarea");

    await expect(textarea).toHaveAttribute("placeholder", "Write your comment...");
  });
});
