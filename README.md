# pi-orchestraitor

A personal [Pi](https://pi.dev) package for practical coding workflows: 56 bundled skills, compact tools, temporary `/btw` conversations, native pi-subagents specialists, a bundled NaN model provider, and optional Context7 and Engram integration.

**Private GitHub distribution.** No npm publication or automatic releases.

## Install

Requires **pnpm 12.9.1**, **Node 22.19+**, and GitHub access to this private repository. The locked development host is **Pi 1.2.0**. The user-authorized release-age exceptions cover only the pinned Pi 1.2.0 packages and pi-subagents 0.78.0; see [current acceptance](.ai/absorb/2026-10-13-pi-subagents.md).

For companion installation, Pi's effective `npmCommand` must use **npm >=11.19.0** or **pnpm 12.9.1** to honor the release-age exceptions. The installer checks this before modifying configuration or moving skills; npm 10 bundled with Node 22.19 is insufficient.

```bash
gh repo clone andresnator/pi-orchestraitor
cd pi-orchestraitor
pnpm install --frozen-lockfile # Once on a fresh checkout
pnpm run install:pi --dry-run
pnpm run test:subagents # Writes .ai/absorb/pi-subagents-validation.json
pnpm run install:pi --subagents-validation .ai/absorb/pi-subagents-validation.json
```

Review the preview before installing: the installer moves conflicting standalone skills into a recoverable backup and installs the pinned Pi Pretty, `pi-claude-bridge@0.9.2`, and `pi-subagents@0.78.0` companions. Shared `~/.agents/skills` entries may also be used by other agents. Use `--without-pretty` to omit Pretty only; Claude Bridge and subagents remain included. Activation requires a current passing isolated validation receipt and the committed release-age policy, including exact-version exceptions. Installation saves skills, selected package registrations, native subagent configuration, and the Pretty bash exclusion for `--restore <backup>`. Old orchestraitor profiles are left inactive.

Keep the checkout available, then restart Pi or run `/reload`; use `pnpm exec pi` to start the local CLI. The installer registers this directory without replacing your global Pi installation. If an original standalone `compact-tools` or `btw` extension is enabled, disable that copy through `pi config` first; keep its files for recovery.

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
/skill:jag-debug investigate this failure
```

Skills load on demand. Replies follow your language; repository artifacts use English. Changes stay unstaged unless you explicitly authorize Git delivery.

For NaN, run `/reload`, then `/login nan` and enter your API key in Pi's private prompt. Select a NaN model through `/model`; your defaults stay unchanged. See [NaN setup and credential boundaries](docs/nan.md).

Context7 requires network access. Memory requires an existing **Engram 3.0.0** installation; this package does not install Engram or enable cloud sync. See [MCP and memory](docs/usage.md#mcp-and-memory) for configuration and disabling servers.

## Update

For the checkout installation, pull changes and refresh dependencies in this directory, then reload Pi:

```bash
git pull --ff-only
pnpm install --frozen-lockfile
```

For native Git installation, use `pi update --extensions`. Recheck compatibility before upgrading Pi; some inventory and integration checks depend on host internals.

## Verify

For development, use **pnpm 12.9.1** to install the locked Pi 1.2.0 test host:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm pack --dry-run --ignore-scripts
```

The npm extracted-package check remains automated. Native plugin checks and real-model acceptance are recorded separately. For the pnpm tarball check, follow the [manual console guide](docs/manual-package-check.md); it is no longer a CI test.

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
