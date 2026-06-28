# Resource Packages

Me Write Code packages bundle extensions, skills, prompt templates, themes, hooks, agents, and MCP config so teams can share agent behavior through npm, git, or local paths.

## Install and manage

```bash
mewrite install npm:@foo/bar@1.0.0
mewrite install git:github.com/user/repo@v1
mewrite install https://github.com/user/repo
mewrite install /absolute/path/to/package
mewrite install ./relative/path/to/package

mewrite remove npm:@foo/bar
mewrite list
mewrite update
```

By default, install/remove update `~/.mewrite/agent/settings.json`. Use project-local settings when you want a repo to share the same package list through `.mewrite/settings.json`.

To load a package for one run without installing it:

```bash
mewrite --extension npm:@foo/bar
mewrite --extension git:github.com/user/repo
```

## Security

Packages can run arbitrary code through extensions and hooks. Skills and prompts can instruct the model to run commands. Review third-party packages before installing them.

## Sources

### npm

```text
npm:@scope/pkg@1.2.3
npm:pkg
```

- Versioned specs are pinned and skipped by `mewrite update`.
- Global installs use `npm install -g`.
- Project installs go under `.mewrite/npm/`.
- Set `npmCommand` in settings to use a wrapper like `mise` or `asdf`.

### git

```text
git:github.com/user/repo@v1
git:git@github.com:user/repo@v1
https://github.com/user/repo@v1
ssh://git@github.com/user/repo@v1
```

- Refs pin the package and skip updates.
- Clones live under `~/.mewrite/agent/git/` or `.mewrite/git/`.
- `npm install` runs after clone/pull when `package.json` exists.
- SSH URLs use the user's normal SSH config.

### local paths

```text
/absolute/path/to/package
./relative/path/to/package
```

Local paths are referenced in settings; files are not copied. Relative paths resolve from the settings file that contains them.

## Package manifest

Declare resources in `package.json` with `mewrite` metadata, or use conventional directories.

```json
{
  "name": "my-package",
  "keywords": ["mewrite-package"],
  "mewrite": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"],
    "agents": ["./agents"],
    "hooks": ["./hooks"]
  }
}
```

Paths are relative to package root. Arrays support glob patterns and `!` exclusions.

Legacy `pi` package metadata may still be read for compatibility, but new packages should use `mewrite`.

## Downstream wrapper resources

Branded wrapper packages can also declare default resources through `mewriteConfig.resources`:

```json
{
  "name": "@example/examplecode",
  "mewriteConfig": {
    "name": "examplecode",
    "displayName": "Example Code",
    "resources": {
      "extensions": ["./extensions"],
      "skills": ["./skills"],
      "prompts": ["./prompts"],
      "themes": ["./themes"],
      "agents": ["./agents"],
      "mcp": ["./mcp/defaults.json"]
    }
  }
}
```

Paths resolve relative to the wrapper package. User and project resources override wrapper defaults. Package-root `.mcp.json` is still read by default unless `mewriteConfig.mcp.includePackageConfig` is `false`.

## Conventional directories

If no manifest is present, Me Write Code discovers:

- `extensions/` — `.ts` and `.js` extension files
- `skills/` — `SKILL.md` directories and top-level Markdown skills
- `prompts/` — Markdown prompt templates
- `themes/` — JSON themes
- `agents/` — Markdown subagent definitions
- `hooks/` — hook scripts
- `.mcp.json` — MCP server definitions

## Dependencies

Runtime dependencies belong in `dependencies`. Packages installed from npm or git run `npm install`, so dependencies are available automatically.

If an extension imports Me Write Code packages, declare them as peer dependencies with a `"*"` range and do not bundle them:

- `@zhachory1/mewrite-code`
- `@zhachory1/mewrite-ai`
- `@zhachory1/mewrite-agent`
- `@zhachory1/mewrite-tui`
- `@sinclair/typebox`

## Filtering

Settings can load only selected resources from a package:

```json
{
  "packages": [
    "npm:simple-pkg",
    {
      "source": "npm:my-package",
      "extensions": ["extensions/*.ts", "!extensions/legacy.ts"],
      "skills": [],
      "prompts": ["prompts/review.md"],
      "themes": ["+themes/legacy.json"]
    }
  ]
}
```

Rules:

- Omit a key to load all resources of that type.
- Use `[]` to load none.
- `!pattern` excludes matches.
- `+path` force-includes an exact path.
- `-path` force-excludes an exact path.

## Scope and deduplication

Packages can appear in both global and project settings. Project entries win. Identity is determined by:

- npm package name
- git repository URL without ref
- resolved absolute local path
