# pi-pretty companion

The supported companion is [`@heyhuynhgiabuu/pi-pretty`](https://github.com/heyhuynhgiabuu/pi-pretty), pinned to **0.6.30** in `package.json` under `config.piPretty`. Pi installs and discovers the upstream package separately; the harness does not copy or fork its source. Its dependencies are managed in Pi's npm directory, so this repository still needs no local `npm install`.

## Installation and recovery

`npm run install:pi -- --dry-run` lists the companion and the planned `pi-pretty.json` path/`disableTools` adjustment without writing or downloading anything. Normal `install:pi` registers the harness and the pinned companion in the same scope and adds `bash` to Pretty's `disableTools`, preserving other preferences. Pretty's bash otherwise replaces Pi's and ignores `shellPath` and `shellCommandPrefix`. The file lives in `PRETTY_CONFIG_DIR` when set, otherwise `$HOME/.pi/agent/`, independently of `PI_CODING_AGENT_DIR` and installation scope. An empty file counts as `{}`, as in Pretty; malformed JSON stops the installation before any change and names the file. `--local --cwd /path/to/project` uses native project trust/registration. Native npm identity avoids duplicate declarations for the same package name and preserves existing resource filters. `--without-pretty` skips companion installation and leaves both its registration and configuration intact.

A registration or skill-verification failure restores both selected declarations, the Pretty adjustment and moved skills, including the original source text, version, filters and package order. npm identity trims the text after `npm:` like Pi, including whitespace-padded declarations. If there are no unrelated edits, settings/configuration files are restored exactly (or removed when newly created). Concurrent unrelated settings, package additions and Pretty preferences are retained; Pretty rollback removes only the installer-added `bash` exclusion. Downloaded npm cache files are not removed by configuration rollback. `--restore` restores a skill backup, not package declarations or Pretty configuration. Remove pretty separately with `pi remove npm:@heyhuynhgiabuu/pi-pretty` (add `--local` for a project declaration). Reload or restart Pi after installation/removal; after an update, restart it, because `/reload` keeps the harness's cached `.mjs` modules.

Installing the harness directly with `pi install /path/to/pi-orchestraitor` loads only its own resources. To add the companion in that workflow, run `pi install npm:@heyhuynhgiabuu/pi-pretty@0.6.30` in the same scope and add `"bash"` to the existing `disableTools` array in Pretty's configuration before reloading:

```json
{ "disableTools": ["bash"] }
```

Merge that field into the existing file. A nonempty comma-separated `PRETTY_DISABLE_TOOLS` list overrides the file and must also include `bash` (tool names are trimmed and case-insensitive). The installer rejects an incompatible environment list before modifying files. Unset the variable or add `bash` to it and rerun the installer. `PRETTY_ENABLE_TOOLS` cannot override a disabled tool.

## Highlight theme

Pretty highlights with a Shiki theme. Without a theme of its own, it uses Pi's `theme` from `$HOME/.pi/agent/settings.json`, but Pi's built-in `dark` and `light` are not Shiki themes. Pretty then warns (`theme "dark" from ~/.pi/agent/settings.json is not a bundled Shiki theme`) and falls back to `github-dark`, even for `light`.

`extensions/pretty-theme.ts` sets `PRETTY_THEME` to `github-dark` or `github-light` on every Pi start and `/reload`. Pretty reads the variable at its first highlight, so either load order works. Nothing is written to disk, so Pretty follows the current Pi theme: after a theme change, restart or `/reload` Pi. The extension leaves the theme to Pretty when `PRETTY_THEME` was set elsewhere, when Pretty's `pi-pretty.json` (in `PRETTY_CONFIG_DIR` or `$HOME/.pi/agent/`) names a nonblank theme, or when Pi uses a custom theme, which Pretty validates itself. A value it set earlier is replaced or removed accordingly. Like Pretty, it reads Pi's settings through HOME, independently of `PI_CODING_AGENT_DIR`. Shell commands and subagents inherit the variable.

## Rendering ownership

| Responsibility | Owner |
| --- | --- |
| Highlight theme for Pi's built-in themes | Harness `pretty-theme.ts`, through `PRETTY_THEME`; Pretty owns any other theme and the highlighting itself. |
| Bash execution | Pi's built-in tool with effective `shellPath` (including `~`) and `shellCommandPrefix`, or whichever extension registers bash. |
| Read when pretty is loaded | Upstream pretty tool definition, renderer and result metadata. |
| Compact presentation of Pi's read, bash, edit, write and native codemode | Harness renderer resolver. |
| Subagents, tasks and questions | Existing harness tools, receipts, accounting and UI. |
| Find/grep, optional ls, prompt editor and activity indicators | Upstream pretty; `ls` remains disabled by its upstream default. |
| Session execution, tool selection and total accounting | Pi and the existing guarded child controller. |

`compact-tools.ts` registers no tools. It registers a tool renderer resolver that draws Pi's own read, bash, edit, write and native codemode calls compactly in either extension load order and after reload. A tool registered by another extension keeps its owner's execution and renderer, so Pretty's read and any bash replacement (a sandbox, SSH or Pretty's bash re-enabled through `PRETTY_DISABLE_TOOLS`) run unchanged and are never blocked. Such a replacement applies its own shell settings. If Pretty is excluded through `pi config`, Pi's read returns with the compact renderer automatically.

Pretty's FFF-backed find/grep replaces native search behavior and initializes an index on session start. Upstream caches default to `~/.pi/agent/pi-pretty/fff/`, using HOME independently of `PI_CODING_AGENT_DIR`. Do not load another package owning the same search tools, such as `pi-fff`, alongside it.

This companion adds highlighting, indexing and presentation work. Read content remains native in the exercised fixtures, and bash retains Pi's native guidelines. The offline harness benchmark excludes Pretty and cannot establish its startup/indexing cost or actual provider-token savings.

Compact results marked as errors display their transformed text explanation when expanded. Candidate task state, subagent results or codemode metadata do not replace that error text or appear as confirmed completion. Successful results retain full expanded details, including subagent batches with individual failures.

## Verification

Run `npm test` for deterministic harness/migration/rollback and foreign-owner coexistence checks without downloading the companion. Run `npm run test:pretty` against the installed pinned package, or set `PI_PRETTY_PACKAGE_DIR=/path/to/installed/package`.

The separate integration runner resolves the installed upstream source before giving its child a temporary HOME, agent directory and Pretty configuration directory. This also isolates upstream FFF storage. The checks use the actual upstream source, native Pi module loader, tools and CLI. They cover both load orders, reload, Pi's custom shell/prefix execution, read content, FFF find/grep, renderers resolved as interactive mode does and preserved selections (including absent bash). An environment override that keeps Pretty's bash is exercised through direct and nested codemode execution, then Pi's bash returns on reload. Pi's grep needs `rg` on `PATH` (or a prior download) because the run is offline. No live provider or MCP request is made. Rendered components and RPC receipts do not substitute for physical TUI/editor/indicator acceptance.
