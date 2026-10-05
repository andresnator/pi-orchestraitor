# pi-pretty companion

The supported companion is [`@heyhuynhgiabuu/pi-pretty`](https://github.com/heyhuynhgiabuu/pi-pretty), pinned to **0.6.30** in `package.json` under `config.piPretty`. Pi installs and discovers the upstream package separately; the harness does not copy or fork its source. Its dependencies are managed in Pi's npm directory, so this repository still needs no local `npm install`.

## Installation and recovery

`npm run install:pi -- --dry-run` lists the companion without downloading it. Normal `install:pi` registers the harness and the pinned companion in the same scope. `--local --cwd /path/to/project` uses native project trust/registration. Native npm identity avoids duplicate declarations for the same package name and preserves existing resource filters. `--without-pretty` skips companion installation and leaves an existing declaration intact.

A registration or skill-verification failure restores both selected declarations and moved skills, including an earlier pretty source/version/filter. Unrelated settings are retained. Downloaded npm cache files are not removed by configuration rollback. `--restore` restores a skill backup, not package declarations. Remove pretty separately with `pi remove npm:@heyhuynhgiabuu/pi-pretty` (add `--local` for a project declaration). Reload or restart Pi after installation/removal.

Installing the harness directly with `pi install /path/to/pi-orchestraitor` loads only its own resources. To add the companion in that workflow, run `pi install npm:@heyhuynhgiabuu/pi-pretty@0.6.30` in the same scope.

## Rendering ownership

| Responsibility | Owner |
| --- | --- |
| Read and bash when pretty is loaded | Upstream pretty tool definitions, renderers and result metadata. |
| Read and bash without a foreign extension owner | Harness compact native definitions, including native shell/image settings. |
| Edit, write and native codemode | Harness compact presentation. |
| Subagents, tasks and questions | Existing harness tools, receipts, accounting and UI. |
| Find/grep, optional ls, prompt editor and activity indicators | Upstream pretty; `ls` remains disabled by its upstream default. |
| Session execution, tool selection and total accounting | Pi and the existing guarded child controller. |

At `session_start`, `compact-tools.ts` checks native tool source metadata and preserves an existing foreign owner of read/bash. This works in either extension load order and after reload. If pretty is excluded through `pi config`, native compact fallbacks return automatically. The harness never adds read/bash to the active selection just to render them.

Pretty uses `pi-pretty.json` under `~/.pi/agent/` (or `PRETTY_CONFIG_DIR`) and `PRETTY_DISABLE_TOOLS` / `PRETTY_ENABLE_TOOLS`; the harness does not rewrite those settings. Its FFF-backed find/grep replaces native search behavior and initializes an index on session start. Upstream caches default to `~/.pi/agent/pi-pretty/fff/`, using HOME independently of `PI_CODING_AGENT_DIR`. Do not load another package owning the same search tools, such as `pi-fff`, alongside it.

This companion adds highlighting, indexing and presentation work. It is not a token-saving change: read/bash text content is preserved in the exercised fixtures, and upstream bash guidelines can add prompt text. The offline harness benchmark excludes pretty and cannot establish its startup/indexing cost or actual provider-token savings.

## Verification

Run `npm test` for deterministic harness/migration/rollback and foreign-owner coexistence checks without downloading the companion. Run `npm run test:pretty` against the installed pinned package, or set `PI_PRETTY_PACKAGE_DIR=/path/to/installed/package`.

The separate integration runner resolves the installed upstream source before giving its child a temporary HOME, agent directory and pretty configuration directory. This also isolates upstream FFF storage. The checks use the actual upstream source, native Pi module loader, tools and CLI. They cover both load orders, reload, read/bash content, FFF find/grep, rendering through native tool components and persistent tool selection. No live provider or MCP request is made. Rendered components and RPC receipts do not substitute for physical TUI/editor/indicator acceptance.
