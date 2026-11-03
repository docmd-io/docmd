---
title: Interactive Playground
description: Live code runner and component sandbox in docmd
---

# Interactive Playground

Experiment with live code execution and UI components directly in your docs.

::: playground "Interactive Component Demo" icon:sparkles
```html
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 2rem 1.5rem; background: linear-gradient(135deg, #6366f1, #a855f7); color: white; border-radius: 12px; box-shadow: 0 10px 25px -5px rgba(99, 102, 241, 0.4);">
  <h2 style="margin: 0 0 0.5rem 0; font-size: 1.5rem; letter-spacing: -0.02em;">Hello from docmd! 🚀</h2>
  <p style="margin: 0 0 1.25rem 0; opacity: 0.95; font-size: 0.95rem;">Edit this markup and click <strong>Run</strong> or press <strong>Cmd+Enter</strong>.</p>
  <button id="counterBtn" style="padding: 0.6rem 1.2rem; border: none; border-radius: 8px; background: white; color: #4f46e5; font-weight: 700; font-size: 0.9rem; cursor: pointer; transition: transform 0.15s ease, box-shadow 0.15s ease;">
    ⚡ Clicks: 0
  </button>
</div>
<script>
  let count = 0;
  const btn = document.getElementById('counterBtn');
  if (btn) {
    btn.onclick = () => {
      count++;
      btn.textContent = `⚡ Clicks: ${count}`;
      btn.style.transform = 'scale(0.96)';
      setTimeout(() => { btn.style.transform = 'scale(1)'; }, 100);
    };
  }
</script>
```
:::

### Console Runner

Run JavaScript directly in the browser sandbox with intercepted console logs and return values:

```js playground title="Algorithm Benchmark" icon:cpu
function fibonacci(n) {
  if (n <= 1) return n;
  let a = 0, b = 1;
  for (let i = 2; i <= n; i++) {
    const next = a + b;
    a = b;
    b = next;
  }
  return b;
}

console.log("Calculating Fibonacci sequence...");
for (let i = 0; i <= 8; i++) {
  console.log(`F(${i}) = ${fibonacci(i)}`);
}

console.log({ status: "success", version: docmd.version });
```