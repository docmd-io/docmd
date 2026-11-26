/**
 * Playwright Screenplay primitives for e2e testing the threads plugin.
 *
 * Adapted from old-discussions-plugin/src/e2e/screenplay.ts for the new
 * inline architecture (server-rendered threads, review UI in a sidebar drawer,
 * WebSocket actions instead of HTTP API).
 */


import type { Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Ability: BrowseTheWeb
// ---------------------------------------------------------------------------

export class BrowseTheWeb {
  constructor(public readonly page: Page) {}
}

// ---------------------------------------------------------------------------
// Actor
// ---------------------------------------------------------------------------

export class Actor {
  private browser: BrowseTheWeb;

  constructor(
    public readonly name: string,
    page: Page,
  ) {
    this.browser = new BrowseTheWeb(page);
  }

  get page(): Page {
    return this.browser.page;
  }

  async perform<T>(task: Task<T>): Promise<T> {
    return task.performAs(this);
  }

  async ask<T>(question: Question<T>): Promise<T> {
    return question.answeredBy(this);
  }
}

export interface Task<T> {
  performAs(actor: Actor): Promise<T>;
}

export interface Question<T> {
  answeredBy(actor: Actor): Promise<T>;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export class NavigateTo implements Task<void> {
  constructor(private path: string) {}

  async performAs(actor: Actor): Promise<void> {
    await actor.page.goto(this.path);
    // Wait for threads-app to be present (plugin loaded)
    await actor.page.waitForSelector("threads-app", { state: "attached", timeout: 10_000 });
  }

  static path(path: string) {
    return new NavigateTo(path);
  }
}

export class SelectText implements Task<void> {
  constructor(
    private selector: string,
    private text: string,
  ) {}

  async performAs(actor: Actor): Promise<void> {
    const sel = this.selector;
    const txt = this.text;
    const coords = await actor.page.evaluate(
      ({ selector, text }) => {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
          let node: Text | null;
          while ((node = walker.nextNode() as Text | null)) {
            const idx = node.textContent?.indexOf(text) ?? -1;
            if (idx >= 0) {
              const range = document.createRange();
              range.setStart(node, idx);
              range.setEnd(node, idx + text.length);
              const rects = range.getClientRects();
              const startRect = rects[0];
              const endRect = rects[rects.length - 1];
              if (!startRect || !endRect) {
                const rect = range.getBoundingClientRect();
                return {
                  startX: rect.left,
                  startY: rect.top + rect.height / 2,
                  endX: rect.right,
                  endY: rect.top + rect.height / 2,
                };
              }
              return {
                startX: startRect.left,
                startY: startRect.top + startRect.height / 2,
                endX: endRect.right,
                endY: endRect.top + endRect.height / 2,
              };
            }
          }
        }
        return null;
      },
      { selector: sel, text: txt },
    );

    if (!coords) throw new Error(`Text "${txt}" not found in ${sel}`);

    await actor.page.mouse.move(coords.startX, coords.startY);
    await actor.page.mouse.down();
    await actor.page.mouse.move(coords.endX, coords.endY);
    await actor.page.mouse.up();
  }

  static within(selector: string, text: string) {
    return new SelectText(selector, text);
  }
}

/**
 * Select text and use the popover "Add comment" to open an inline editor,
 * then fill and submit to create a new thread.
 */
export class StartThreadOn implements Task<void> {
  constructor(
    private selector: string,
    private selectedText: string,
    private comment: string,
  ) {}

  async performAs(actor: Actor): Promise<void> {
    await actor.perform(SelectText.within(this.selector, this.selectedText));

    // Wait for popover and click "Add comment"
    const popoverBtn = actor.page.locator("threads-popover").getByText("Add comment");
    await popoverBtn.waitFor({ state: "visible", timeout: 5_000 });
    await popoverBtn.click();

    // Fill in the inline editor
    const editor = actor.page.locator("threads-inline-editor");
    await editor.waitFor({ state: "attached", timeout: 5_000 });

    const textarea = editor.locator("sl-textarea").locator("textarea");
    await textarea.waitFor({ timeout: 5_000 });
    await textarea.fill(this.comment);

    // Submit
    const submitBtn = editor.locator("sl-button[variant='primary']");
    await submitBtn.click();

    // Wait for editor to detach (submission complete)
    await editor.waitFor({ state: "detached", timeout: 10_000 });
  }

  static on(selector: string, selectedText: string, comment: string) {
    return new StartThreadOn(selector, selectedText, comment);
  }
}

/**
 * Click the "New Thread" button and submit a general (unanchored) thread.
 */
export class AddNewThread implements Task<void> {
  constructor(private body: string) {}

  async performAs(actor: Actor): Promise<void> {
    const newThreadBtn = actor.page.locator(".threads-new-thread-btn").first();
    await newThreadBtn.click();

    const editor = actor.page.locator("threads-inline-editor");
    await editor.waitFor({ state: "attached", timeout: 5_000 });

    const textarea = editor.locator("sl-textarea").locator("textarea");
    await textarea.waitFor({ timeout: 5_000 });
    await textarea.fill(this.body);

    const submitBtn = editor.locator("sl-button[variant='primary']");
    await submitBtn.click();

    await editor.waitFor({ state: "detached", timeout: 10_000 });
  }

  static withBody(body: string) {
    return new AddNewThread(body);
  }
}

/**
 * Click the Reply button on a server-rendered thread card and submit a reply.
 */
export class ReplyToThread implements Task<void> {
  constructor(
    private threadSelector: string,
    private comment: string,
  ) {}

  async performAs(actor: Actor): Promise<void> {
    const threadEl = actor.page.locator(this.threadSelector);
    const replyBtn = threadEl.locator(".threads-comment-reply-btn").first();
    await replyBtn.click();

    const editor = actor.page.locator("threads-inline-editor");
    await editor.waitFor({ state: "attached", timeout: 5_000 });

    const textarea = editor.locator("sl-textarea").locator("textarea");
    await textarea.waitFor({ timeout: 5_000 });
    await textarea.fill(this.comment);

    const submitBtn = editor.locator("sl-button[variant='primary']");
    await submitBtn.click();

    await editor.waitFor({ state: "detached", timeout: 10_000 });
  }

  static on(threadSelector: string, comment: string) {
    return new ReplyToThread(threadSelector, comment);
  }
}

export class SubmitWithKeyboard implements Task<void> {
  async performAs(actor: Actor): Promise<void> {
    const editor = actor.page.locator("threads-inline-editor");
    await editor.waitFor({ state: "attached", timeout: 3_000 });

    const textarea = editor.locator("sl-textarea").locator("textarea");
    await textarea.click();

    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await actor.page.keyboard.press(`${modifier}+Enter`);
  }

  static inInlineEditor() {
    return new SubmitWithKeyboard();
  }
}

export class CancelWithKeyboard implements Task<void> {
  async performAs(actor: Actor): Promise<void> {
    const editor = actor.page.locator("threads-inline-editor");
    await editor.waitFor({ state: "attached", timeout: 3_000 });

    const textarea = editor.locator("sl-textarea").locator("textarea");
    await textarea.click();

    await actor.page.keyboard.press("Escape");
  }

  static inInlineEditor() {
    return new CancelWithKeyboard();
  }
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export class TheThreadCount implements Question<number> {
  async answeredBy(actor: Actor): Promise<number> {
    return actor.page.locator(".threads-thread[data-thread-id]").count();
  }

  static count() {
    return new TheThreadCount();
  }
}

export class TheHighlightCount implements Question<number> {
  async answeredBy(actor: Actor): Promise<number> {
    return actor.page.locator("mark.threads-highlight[data-thread-id]").count();
  }

  static count() {
    return new TheHighlightCount();
  }
}

export class TheInlineEditor implements Question<boolean> {
  async answeredBy(actor: Actor): Promise<boolean> {
    return (await actor.page.locator("threads-inline-editor").count()) > 0;
  }

  static isVisible() {
    return new TheInlineEditor();
  }
}

export class TheDeleteDialog implements Question<boolean> {
  async answeredBy(actor: Actor): Promise<boolean> {
    return actor.page.locator("sl-dialog#delete-dialog").isVisible();
  }

  static isOpen() {
    return new TheDeleteDialog();
  }
}

export class TheCommentBody implements Question<string> {
  constructor(
    private threadId: string,
    private commentIndex: number,
  ) {}

  async answeredBy(actor: Actor): Promise<string> {
    const thread = actor.page.locator(`.threads-thread[data-thread-id="${this.threadId}"]`);
    const comment = thread.locator(".threads-comment").nth(this.commentIndex);
    const body = comment.locator(".threads-comment__body");
    return (await body.textContent()) ?? "";
  }

  static of(threadId: string, commentIndex: number) {
    return new TheCommentBody(threadId, commentIndex);
  }
}
