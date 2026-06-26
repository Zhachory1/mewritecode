# @zhachory1/mewrite-markdown-preview

Rendered markdown + LaTeX preview for [Me Write Code](https://github.com/Zhachory1/mewritecode) — terminal, browser, and PDF output.

Loaded as a `@zhachory1/mewrite-code` extension; not intended as a standalone library.

## Install

Bundled with `@zhachory1/mewrite-code` by default. To load explicitly:

```bash
mewrite --extension @zhachory1/mewrite-markdown-preview "render this README"
```

## What it does

- Renders markdown to a paginated, styled terminal view.
- Exports the same rendered output to a single-file HTML page or PDF via headless Chrome.
- Handles LaTeX math via KaTeX.

## License

MIT — see [LICENSE](../../LICENSE).
