# @docmd/plugin-iconify

Adds Iconify icon integration to your docmd site - use over 200,000+ open-source icons from collections like Material Design, Carbon, Tabler, Lucide, FontAwesome, Solar, and more directly in docmd containers. An optional plugin, installed separately.

```bash
docmd add iconify
```

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

Part of the **[docmd](https://github.com/docmd-io/docmd)** documentation engine.

## Documentation

See **[docs.docmd.io](https://docs.docmd.io)** for full usage and API reference.

## License

MIT