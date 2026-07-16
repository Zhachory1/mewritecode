# Contributing to Me Write Code

Contributing here means contributing to Me Write Code maintained in [Zhachory1/mewritecode](https://github.com/Zhachory1/mewritecode).

## The One Rule

**You must understand your code.** If you can't explain what your changes do and how they interact with the rest of the system, your PR will be closed.

Using AI to write code is fine. You can gain understanding by interrogating an agent with access to the codebase until you grasp all edge cases and effects of your changes. What's not fine is submitting agent-generated slop without that understanding.

If you use an agent, run it from the `mewritecode` root directory so it picks up `AGENTS.md` automatically. Your agent must follow the rules and guidelines in that file.

## First-Time Contributors

We use an approval gate for new contributors:

1. Open an issue describing what you want to change and why
2. Keep it concise (if it doesn't fit on one screen, it's too long)
3. Write in your own voice, at least for the intro
4. A maintainer will comment `lgtm` if approved
5. Once approved, you can submit PRs

This exists because AI makes it trivial to generate plausible-looking but low-quality contributions. The issue step lets us filter early.

## Before Submitting a PR

```bash
npm run check  # must pass with no errors
./test.sh      # must pass
```

Do not edit `CHANGELOG.md`. Changelog entries are added by maintainers.

If you're adding a new provider to `packages/ai`, see `AGENTS.md` for required tests.

## Philosophy

Me Write Code's core is minimal. If your feature doesn't belong in the core, it should be an extension. PRs that bloat the core will likely be rejected.

## Good First Issues

Look for issues labeled [`good first issue`](https://github.com/Zhachory1/mewritecode/labels/good%20first%20issue). These are scoped, well-described tasks suitable for new contributors.

Some areas where contributions are especially welcome:

- **Extensions** — build a new extension and submit it as a package
- **Provider support** — add or improve an LLM provider in `packages/ai`
- **Themes** — create and share custom terminal themes
- **Documentation** — improve docs, fix typos, add examples
- **Benchmarks** — add new compression fixtures or improve measurement
