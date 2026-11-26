---
title: "docmd _playground"
description: "A testing ground for docmd core engine features."
---

This playground is used to verify core engine changes in real-time. Use this to ensure your modifications to the Markdown parser or UI components behave as expected.

::: callout tip "How to work here"
To test your changes, keep the dev server running (`pnpm run dev`). Any change you make to `packages/core` or `packages/parser` will trigger a hot-reload here instantly.
:::

## Component Verification

Test your UI components and parser rules here to ensure visual consistency:

::: card "Container Test"
    Test nested callouts and containers.

    ::: callout warning "Warning"
    Ensure nested items render correctly.
    :::
:::

::: tabs
== tab "Feature A"
### Feature A
Verification content.
== tab "Feature B"
### Feature B
Verification content.
:::

## 🔗 Useful Links

- [Official Documentation](https://docs.docmd.io)
- [GitHub Repository](https://github.com/docmd-io/docmd)
- [Report an Issue](https://github.com/docmd-io/docmd/issues)
- [Linked page](/linked/)

## 🧪 Developer Checklist
- [ ] **Parser:** Does the Markdown output match the HTML in `packages/parser/src/html-renderer.js`?
- [ ] **UI:** Does the theme CSS apply to this page correctly?
- [ ] **SPA:** Does navigation between pages work without a hard refresh?

## Threads Plugin Test

This section tests the ==inline discussion threads=={t-thread1} plugin. You can ==highlight text=={t-thread2} and start discussions.

Here is another paragraph with a ==different highlight=={t-thread3} to test multiple threads.

::: threads

::: thread t-thread1
::: comment c1-1 "Alice" "2026-03-01"
This is a comment about inline discussion threads.
:::
::: comment c1-2 "Bob" "2026-03-02"
Great point, Alice! I agree this is useful.
:::
:::

::: thread t-thread2
::: comment c2-1 "Charlie" "2026-03-03"
Highlighting text makes it easy to reference specific parts.
:::
:::

::: thread t-thread3 resolved "Alice" "2026-03-05"
::: comment c3-1 "Alice" "2026-03-04"
This highlight tests resolved threads.
:::
::: comment c3-2 "Bob" "2026-03-05"
Resolved! Use `console.log()` for debugging.
:::
:::

:::