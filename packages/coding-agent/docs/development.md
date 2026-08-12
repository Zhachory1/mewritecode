# Development

See [AGENTS.md](../../../AGENTS.md) for additional guidelines.

## Setup

```bash
git clone https://github.com/Zhachory1/mewritecode
cd mewritecode
npm install
npm run build
```

Run from source:

```bash
/path/to/mewritecode/test.sh
```

The script can be run from any directory. Me Write Code keeps the caller's current working directory.

## Forking / Rebranding

Configure via `package.json`:

```json
{
  "mewriteConfig": {
    "name": "mewrite",
    "configDir": ".mewrite"
  }
}
```

Change `name`, `configDir`, and `bin` field for your fork. Affects CLI banner, config paths, and environment variable names.

### Branding the logo / wordmark

`mewriteConfig.branding` rebrands the interactive startup banner and the
`mewrite agents` view (both share one renderer):

```json
{
  "mewriteConfig": {
    "name": "acme-code",
    "branding": {
      "primaryWordmark":   ["▄▀█ █▀▀ █▀▄▀█ █▀▀", "█▀█ █▄▄ █░▀░█ ██▄"],
      "secondaryWordmark": ["█▀▀ █▀█ █▀▄ █▀▀",   "█▄▄ █▄█ █▄▀ ██▄"],
      "logoPath": "assets/logo.png",
      "logoMaxWidthCells": 20,
      "tagline": "ACME custom distribution."
    }
  }
}
```

- **`primaryWordmark` / `secondaryWordmark`** — ASCII/Unicode art. **Setting
  `primaryWordmark` replaces the built-in pencil entirely** — your art renders
  standalone, so a distribution presents its own mark rather than annotating the
  upstream pencil. `secondaryWordmark` stacks below the primary on tall terminals
  (>= 32 rows). With neither set, the built-in pencil + "Me Write Code" block is
  shown.
- **`logoPath`** — an image logo (PNG/etc., resolved relative to the package
  dir). Takes precedence over the wordmarks: graphics-capable terminals render
  the image; other terminals fall back to a text placeholder.

A standalone `primaryWordmark` is bounded only by the terminal width (each row is
truncated to fit). The built-in default block wordmark, which renders **beside**
the pencil, is held to a fixed box (max 12 rows, 40 cells wide) so it stays
within the pencil's footprint.

## Path Resolution

Three execution modes: npm install, standalone binary, tsx from source.

**Always use `src/config.ts`** for package assets:

```typescript
import { getPackageDir, getThemeDir } from "./config.js";
```

Never use `__dirname` directly for package assets.

## Debug Command

`/debug` (hidden) writes to `~/.mewrite/agent/mewrite-debug.log`:
- Rendered TUI lines with ANSI codes
- Last messages sent to the LLM

## Testing

```bash
./test.sh                         # Run non-LLM tests (no API keys needed)
npm test                          # Run all tests
npm test -- test/specific.test.ts # Run specific test
```

## Project Structure

```
packages/
  ai/           # LLM provider abstraction
  agent/        # Agent loop and message types  
  tui/          # Terminal UI components
  coding-agent/ # CLI and interactive mode
```
