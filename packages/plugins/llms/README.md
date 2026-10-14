# @docmd/plugin-llms

Generates `llms.txt` and `llms-full.txt` at build time so your documentation is immediately accessible to AI agents - ChatGPT, Claude, Cursor, and any tool that follows the [llmstxt.org](https://llmstxt.org/) standard.

Bundled with `@docmd/core`. Requires `siteUrl` in your config to produce valid absolute links.

```js
// docmd.config.js
module.exports = {
  siteUrl: 'https://your-site.com',
  plugins: {
    llms: {
      // Optional: Custom system prompt / AI instructions included in context files
      prompt: 'You are an AI assistant helping developers with this project.',
      // Optional: Enable multi-locale generation (llms.<locale>.txt)
      i18n: true
    }
  }
};
```

### Features

- **Standard `llms.txt`**: Curated index of documentation links with descriptions.
- **Section-aware Grouping**: Automatically groups files by category/section (using frontmatter `section`/`category` or directory structure).
- **Custom System Prompt**: Embed specialized AI assistant guidelines into `llms.txt`, `llms-full.txt`, and `llms.json`.
- **Full Context (`llms-full.txt`)**: Complete concatenated documentation bundle for large context window models.
- **Machine-readable (`llms.json`)**: Structured index with section metadata and priorities.
- **Multi-locale Support**: Generates per-locale files when `i18n: true`.

Part of the **[docmd](https://github.com/docmd-io/docmd)** documentation engine.

## Documentation

See **[docs.docmd.io](https://docs.docmd.io)** for full usage and API reference.

## License

MIT