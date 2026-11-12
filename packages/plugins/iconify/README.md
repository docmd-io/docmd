# @docmd/plugin-iconify

Optional Iconify icon integration for docmd.

Use over 200,000+ open-source icons from collections like Material Design, Carbon, Tabler, Lucide, FontAwesome, Solar, and more directly in docmd containers.

## Installation

```bash
docmd add iconify
```

Or configure in `docmd.config.json`:

```json
{
  "plugins": {
    "iconify": {}
  }
}
```

## Syntax

Use simple and intuitive prefixes in your markdown containers:

```markdown
::: callout icon:iconify:mdi:home
Welcome to our documentation site!
:::

::: button title:"GitHub Repo" url:"https://github.com/docmd-io/docmd" icon:iconify:carbon:logo-github
:::

::: card title:"Features" icon:iconify-solar:shield-check-bold
High performance with inlined SVGs and zero runtime client JavaScript overhead.
:::
```

Both `icon:iconify:<set>:<name>` and `icon:iconify-<set>-<name>` (or `icon:iconify-<set>:<name>`) are supported.