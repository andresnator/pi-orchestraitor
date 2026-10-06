# pi-orchestraitor

A personal [Pi](https://pi.dev) package for practical coding workflows: 56 bundled skills, compact tools, bounded subagents, and optional Context7 and Engram integration.

**Private GitHub distribution.** No npm publication or automatic releases.

## Install

Requires **Pi 1.0.4** (current verification baseline), **Node 22.19+**, and GitHub access to this private repository.

```bash
gh repo clone andresnator/pi-orchestraitor
cd pi-orchestraitor
npm run install:pi -- --dry-run
npm run install:pi
```

Review the preview before installing: the installer moves conflicting standalone skills into a recoverable backup and installs the pinned Pi Pretty companion. Shared `~/.agents/skills` entries may also be used by other agents. Use `--without-pretty` to omit the companion.

No local `npm install` is needed; Pi supplies extension dependencies. Keep the checkout available, then restart Pi or run `/reload`. If an original standalone `compact-tools` extension is enabled, disable that copy through `pi config` first.

For a clean profile without skill migration or the Pretty companion, native Git installation is also supported with SSH access:

```bash
pi install git:git@github.com:andresnator/pi-orchestraitor.git
```

Do not register both the checkout and the Git source. See [installation, conflicts, and recovery](docs/usage.md#install) for project-local installation and rollback details.

## Use

```text
/orchestraitor fix the behavior of X within Y
/plan prepare change Z
/review src/module.ts
/skill:jag-debug investigate this failure
```

Skills load on demand. Replies follow your language; repository artifacts use English. Changes stay unstaged unless you explicitly authorize Git delivery.

Context7 requires network access. Memory requires an existing **Engram 3.0.0** installation; this package does not install Engram or enable cloud sync. See [MCP and memory](docs/usage.md#mcp-and-memory) for configuration and disabling servers.

## Update

For the checkout installation, pull changes in this directory and reload Pi:

```bash
git pull --ff-only
```

For native Git installation, use `pi update --extensions`. Recheck compatibility before upgrading Pi; some inventory and integration checks depend on host internals.

## Verify

```bash
npm test
npm pack --dry-run --ignore-scripts
```

GitHub CI runs these checks on Node 22 and 24 with Pi 1.0.4. It does not publish, call live models, or connect to memory services. GitHub-hosted CI has not been verified until the workflow is pushed and runs successfully.

## More

- [Usage, installation recovery, and package resources](docs/usage.md)
- [Skill catalog](docs/skills.md)
- [Subagents and their limits](docs/subagents.md)
- [Interactive UI](docs/interactive-ui.md)
- [Verification evidence](docs/verification.md)
- [License](LICENSE) and [third-party attribution](THIRD_PARTY_NOTICES.md)

Extensions execute with your user permissions. Behavioral instructions and child tool guards are **not an OS sandbox**.
