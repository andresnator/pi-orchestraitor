---
name: jag-arch-map
description: "Map architecture from code evidence: C4-lite maps, flows and drift checks, a verified state snapshot, or one service's inputs and outputs."
disable-model-invocation: true
license: MIT
compatibility: "Pi 1.0.0; use available tools and declare optional external prerequisites."
metadata:
  pi_adaptation: "2.0.0"
  modification_notice: "Modified for Pi by pi-orchestraitor."
  author: andresnator
  version: "2.1.0"
  status: testing
---

# Architecture Map

## Modes

- **Map** (default): follow the sections below.
- **State:** record verified languages, toolchain, frameworks, modules, style and tests/CI for downstream work. Follow [references/state.md](references/state.md).
- **Boundaries:** map one backend service's inputs and outputs with evidence and confidence. Follow [references/boundaries.md](references/boundaries.md).

Choose the mode from the request; ask only when it is unclear.

## Contract

Create system context, containers, representative runtime flows from verified code evidence. No code-level design, user story mapping, or AI-harness analysis.

- Each node and edge cites manifest, config, import, entrypoint, deployment descriptor, or underlying `file:line` resolved through healthy graph. Mark anything else `hypothesis`.
- Use GitHub-renderable Mermaid `flowchart` and `sequenceDiagram` only.
- Maximum about 30 nodes per diagram and 120 lines per file. Split before exceeding either.
- Write to `docs/architecture/` when `docs/` exists; create that child as needed. Otherwise use existing `doc/architecture/`, or create it when neither root exists.

## Shape

Default: one `index.md` containing system context, containers, 1-3 key flows. Use skeleton in `assets/architecture-doc-set.md`.

Split only when the default exceeds a budget:

- Move context and containers to `overview.md`.
- Move flows to `flows.md`.
- For multiple deployables, keep workspace context in `index.md`; add `projects/<name>.md` only when one diagram cannot stay within budget.

Cross-project edges need manifest, config, deployment, topic, URL, or shared-schema evidence. Per-project graph never proves them.

## Refresh

Regenerate from current evidence; diff against recorded source commit; update changed files only; never remove manually owned files. Report added/removed containers, dependency changes, flow changes.

## Output

Return docfolder, files written or updated, `initial generation` or drift summary, hypotheses. Verify balanced Mermaid blocks, cross-links when split, budgets, source commit.
