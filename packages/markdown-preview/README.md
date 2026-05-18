# @juliusbrussee/caveman-markdown-preview

Rendered markdown + LaTeX preview for [Caveman Code](https://github.com/JuliusBrussee/caveman-cli) — terminal, browser, and PDF output.

Loaded as a `@juliusbrussee/caveman-code` extension; not intended as a standalone library.

## Install

Bundled with `@juliusbrussee/caveman-code` by default. To load explicitly:

```bash
caveman --extension @juliusbrussee/caveman-markdown-preview "render this README"
```

## What it does

- Renders markdown to a paginated, styled terminal view.
- Exports the same rendered output to a single-file HTML page or PDF via headless Chrome.
- Handles LaTeX math via KaTeX.

## License

MIT — see [LICENSE](../../LICENSE).
