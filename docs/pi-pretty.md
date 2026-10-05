# pi-pretty companion

The supported companion is [`@heyhuynhgiabuu/pi-pretty`](https://github.com/heyhuynhgiabuu/pi-pretty), pinned to **0.6.30** in `package.json` under `config.piPretty`. Pi installs and discovers the upstream package separately; the harness does not copy or fork its source. Its dependencies are managed in Pi's npm directory, so this repository still needs no local `npm install`.

## Installation and recovery

`npm run install:pi -- --dry-run` lists the companion and the planned `pi-pretty.json` path/`disableTools` adjustment without writing or downloading anything. Normal `install:pi` registers the harness and the pinned companion in the same scope and adds `bash` to Pretty's `disableTools`, preserving other preferences. The file lives in `PRETTY_CONFIG_DIR` when set, otherwise `$HOME/.pi/agent/`, independently of `PI_CODING_AGENT_DIR` and installation scope. `--local --cwd /path/to/project` uses native project trust/registration. Native npm identity avoids duplicate declarations for the same package name and preserves existing resource filters. `--without-pretty` skips companion installation and leaves both its registration and configuration intact.

A registration or skill-verification failure restores both selected declarations, the Pretty adjustment and moved skills, including the original source text, version, filters and package order. npm identity trims the text after `npm:` like Pi, including whitespace-padded declarations. If there are no unrelated edits, settings/configuration files are restored exactly (or removed when newly created). Concurrent unrelated settings, package additions and Pretty preferences are retained; Pretty rollback removes only the installer-added `bash` exclusion. Downloaded npm cache files are not removed by configuration rollback. `--restore` restores a skill backup, not package declarations or Pretty configuration. Remove pretty separately with `pi remove npm:@heyhuynhgiabuu/pi-pretty` (add `--local` for a project declaration). Reload or restart Pi after installation/removal.

Installing the harness directly with `pi install /path/to/pi-orchestraitor` loads only its own resources. To add the companion in that workflow, run `pi install npm:@heyhuynhgiabuu/pi-pretty@0.6.30` in the same scope and add `"bash"` to the existing `disableTools` array in Pretty's configuration before reloading:

```json
{ "disableTools": ["bash"] }
```

Merge that field into the existing file. A nonempty comma-separated `PRETTY_DISABLE_TOOLS` list overrides the file and must also include `bash` (tool names are trimmed and case-insensitive). The installer rejects an incompatible environment list before modifying files. Unset the variable or add `bash` to it and rerun the installer. `PRETTY_ENABLE_TOOLS` cannot override a disabled tool.

## Rendering ownership

| Responsibility | Owner |
| --- | --- |
| Bash | Harness compact native definition with effective `shellPath` and `shellCommandPrefix`. |
| Read when pretty is loaded | Upstream pretty tool definition, renderer and result metadata. |
| Read without a foreign extension owner | Harness compact native definition, including native image settings. |
| Edit, write and native codemode | Harness compact presentation. |
| Subagents, tasks and questions | Existing harness tools, receipts, accounting and UI. |
| Find/grep, optional ls, prompt editor and activity indicators | Upstream pretty; `ls` remains disabled by its upstream default. |
| Session execution, tool selection and total accounting | Pi and the existing guarded child controller. |

At `session_start`, `compact-tools.ts` preserves an existing foreign read owner and always registers its own bash with `defaultActive: false`. With Pretty's bash disabled, the harness owns bash in either extension load order and after reload, preserving the user's selection. If another extension retains bash, the harness reports its source on startup/reload and blocks bash calls, including calls nested inside codemode, until configuration is corrected and reloaded. Ownership is rechecked before agent turns and each bash call. If Pretty is excluded through `pi config`, the native compact read fallback returns automatically.

Pretty's FFF-backed find/grep replaces native search behavior and initializes an index on session start. Upstream caches default to `~/.pi/agent/pi-pretty/fff/`, using HOME independently of `PI_CODING_AGENT_DIR`. Do not load another package owning the same search tools, such as `pi-fff`, alongside it.

This companion adds highlighting, indexing and presentation work. Read content remains native in the exercised fixtures, and bash retains the native harness guidelines. The offline harness benchmark excludes Pretty and cannot establish its startup/indexing cost or actual provider-token savings.

Compact results marked as errors display their transformed text explanation when expanded. Candidate task state, subagent results or codemode metadata do not replace that error text or appear as confirmed completion. Successful results retain full expanded details, including subagent batches with individual failures.

## Verification

Run `npm test` for deterministic harness/migration/rollback and foreign-owner coexistence checks without downloading the companion. Run `npm run test:pretty` against the installed pinned package, or set `PI_PRETTY_PACKAGE_DIR=/path/to/installed/package`.

The separate integration runner resolves the installed upstream source before giving its child a temporary HOME, agent directory and Pretty configuration directory. This also isolates upstream FFF storage. The checks use the actual upstream source, native Pi module loader, tools and CLI. They cover both load orders, reload, custom shell/prefix execution, read content, FFF find/grep, rendering through native tool components and preserved selections (including absent bash). A conflicting environment override is exercised through native nested execution, then corrected on reload. No live provider or MCP request is made. Rendered components and RPC receipts do not substitute for physical TUI/editor/indicator acceptance.
