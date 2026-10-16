# pi-orchestraitor

A personal [Pi](https://pi.dev) package for practical coding workflows: 57 bundled skills, compact tools, temporary `/btw` conversations, bounded subagents, a bundled NaN model provider, and optional Context7 and Engram integration.

**Private GitHub distribution.** No npm publication or automatic releases.

## Install

Requires **pnpm 12.9.1**, **Node 22.19+**, and GitHub access to this private repository. The checkout uses Pi 1.3.0 from the lockfile.

```bash
gh repo clone andresnator/pi-orchestraitor
cd pi-orchestraitor
pnpm install --frozen-lockfile # Once on a fresh checkout
pnpm run install:pi --dry-run
pnpm run install:pi
```

Review the preview before installing: the installer moves conflicting standalone skills into a recoverable backup and installs the pinned Pi Pretty and `pi-claude-bridge@0.9.3` companions. Shared `~/.agents/skills` entries may also be used by other agents. Use `--without-pretty` to omit Pretty only; Claude Bridge remains included.

Keep the checkout available, then restart Pi; `/reload` is enough only if the running Pi never loaded this package. Use `pnpm exec pi` to start the local CLI. The installer registers this directory without replacing your global Pi installation. If an original standalone `compact-tools` or `btw` extension is enabled, disable that copy through `pi config` first; keep its files for recovery.

For a clean profile without skill migration or either companion, native Git installation is also supported with SSH access:

```bash
pi install git:git@github.com:andresnator/pi-orchestraitor.git
```

Do not register both the checkout and the Git source. See [installation, conflicts, and recovery](docs/usage.md#install) for project-local installation and rollback details.

## Use

```text
/orchestraitor fix the behavior of X within Y
/plan prepare change Z
/review src/module.ts
/btw explain this without changing the main task
/auto-compact 150k
/skill:jag-debug investigate this failure
/skill:jag-wait-what explain the last answer
```

Skills load on demand. Replies follow your language; repository artifacts use English. Changes stay unstaged unless you explicitly authorize Git delivery.

Use `/auto-compact <tokens>` to persist the current model's automatic compaction threshold (`150k`, `0.5m`, or `300000`); no argument shows it, and `default` restores inherited settings. Saving reloads Pi and closes active readers/panels. See [automatic compaction](docs/usage.md#automatic-compaction).

For NaN, run `/reload`, then `/login nan` and enter your API key in Pi's private prompt. Select a NaN model through `/model`; your defaults stay unchanged. See [NaN setup and credential boundaries](docs/nan.md).

Context7 requires network access. Memory requires an existing **Engram 3.0.0** installation; this package does not install Engram or enable cloud sync. See [MCP and memory](docs/usage.md#mcp-and-memory) for configuration and disabling servers.

## Update

For the checkout installation, pull changes and refresh dependencies in this directory, then restart Pi:

```bash
git pull --ff-only
pnpm install --frozen-lockfile
```

For native Git installation, use `pi update --extensions`, then restart Pi. `/reload` is not enough after a code update: it re-evaluates the TypeScript extensions, but Node keeps the `.mjs` modules it already loaded (`extensions/subagent/`, `extensions/skills/`, `extensions/models/`, `extensions/pretty/`, `extensions/provider-options.mjs`) while each new child process loads the updated files. Recheck compatibility before upgrading Pi; some inventory and integration checks depend on host internals.

## Verify

For development, use **pnpm 12.9.1** to install the locked Pi 1.3.0 test host:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm pack --dry-run --ignore-scripts
```

The npm extracted-package check remains automated. For the pnpm tarball check, follow the [manual console guide](docs/manual-package-check.md); it is no longer a CI test.

The install policy keeps a 24-hour release cooldown and blocks dependency build scripts; see [development security](docs/usage.md#development-security). The test host is development-only and is not bundled.

GitHub CI uses the same lockfile on Node 22 and 24. It does not publish, call live models, or connect to memory services. The pnpm workflow must pass on GitHub after it is pushed; previous npm-based CI passed.

## More

- [Usage, installation recovery, and package resources](docs/usage.md)
- [Skill catalog](docs/skills.md)
- [Subagents and their limits](docs/subagents.md)
- [Temporary BTW conversations and explicit imports](docs/btw.md)
- [NaN login and model provider](docs/nan.md)
- [Interactive UI](docs/interactive-ui.md)
- [Verification evidence](docs/verification.md)
- [License](LICENSE) and [third-party attribution](THIRD_PARTY_NOTICES.md)

Extensions execute with your user permissions. Behavioral instructions and child tool guards are **not an OS sandbox**.
