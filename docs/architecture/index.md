# Understand the harness in five minutes

**One main agent plans and coordinates. Skills guide it; prompts start requests; extensions add executable behavior. There is no durable SDD engine.**

Source: `7232484becc7895167d3b3d063765a8186b3541d` plus the authorized interactive-UI working tree, inspected on 2026-10-04 with Pi 1.0.2. This describes the candidate, not the commit alone or completed acceptance. Historical verification remains separate. User-authorized exception to architecture-map's usual exclusion of AI harnesses.

## Read only what you need

1. This page: what the pieces do.
2. [Choose a workflow](flows.md): diagrams and a small example for every route.
3. [Execute and delegate](execution.md): who changes files, who checks them, and when work stops.
4. [Interactive UI](../interactive-ui.md): one presentation owner, task receipts and user decisions.

## System context

```mermaid
flowchart LR
  U[User] -->|request: A| P[Pi main session + harness]
  P -->|inspect / edit / verify: B| R[Target repository]
  P -->|library documentation: C| C7[Context7 MCP]
  P -->|project memory: C| E[Engram MCP]
  P -->|bounded task: D| H[Fresh child Pi sessions]
  H -->|restricted file tools: D| R
  H -->|result and write ledger: D| P
```

Evidence for nodes and edges:
- **A:** [prompts/orchestraitor.md:5–8](../../prompts/orchestraitor.md), [prompts/plan.md:5–12](../../prompts/plan.md).
- **B:** [instructions/orchestraitor.md](../../instructions/orchestraitor.md).
- **C:** [extensions/mcp.ts:3–19](../../extensions/mcp.ts). Registration is not proof of service availability. Engram is not an SDD state store.
- **D:** [extensions/subagents.ts](../../extensions/subagents.ts), [extensions/subagent/runtime.mjs:7–29](../../extensions/subagent/runtime.mjs), [extensions/subagent/guard.mjs:13–83](../../extensions/subagent/guard.mjs).

## Inside the package

These are logical components, **not separately deployed services**. Delegated children and the explicitly opened optional Herdr companion get separate processes; the companion is presentation only.

```mermaid
flowchart TB
  M[package.json] -->|declares: E| X[Five extensions]
  M -->|declares: E| P[Four prompt templates]
  M -->|declares: E| S[Skill catalog]
  P -->|request instructions: F| A[Main agent]
  S -->|selected guidance: G| A
  X -->|instructions.ts injects: H| I[core / orchestraitor / personality]
  I -->|system prompt sections: H| A
  X -->|compact-tools.ts decorates: I| T[Native tool presentation]
  X -->|mcp.ts registers: J| MCP[Context7 / Engram]
  X -->|subagents.ts registers: K| SR[subagent_run]
  A -->|optional delegation: K| SR
  SR -->|controller spawns: L| CH[Child process + guard]
  X -->|status-ui.ts owns: M| UI[Task widget / native footer / modal]
  SR -->|native observations: M| UI
  A -->|model-only tasks / questions: M| UI
  UI -->|eligible Herdr private display snapshots: N| WB[Separate Herdr companion]
  HA[User-invoked Herdr action] -->|verified owned pane lifecycle: N| WB
```

| Evidence | Source |
| --- | --- |
| E | [package.json](../../package.json): extension, skill and prompt resource declarations. |
| F | [prompts/plan.md:5–8](../../prompts/plan.md), [prompts/orchestraitor.md:5–6](../../prompts/orchestraitor.md), [prompts/review.md:5–8](../../prompts/review.md), [prompts/absorb.md:5–7](../../prompts/absorb.md). |
| G | [README.md](../../README.md), [skills/implementation-skill-routing/SKILL.md:20–28](../../skills/implementation-skill-routing/SKILL.md): catalog selection, then body loading. |
| H | [extensions/instructions.ts:4–19](../../extensions/instructions.ts): adds sections without replacing Pi/project context. |
| I | [extensions/compact-tools.ts](../../extensions/compact-tools.ts): presentation, not a scheduler. |
| J | [extensions/mcp.ts:6–19](../../extensions/mcp.ts). |
| K | [extensions/subagents.ts](../../extensions/subagents.ts), [instructions/orchestraitor.md](../../instructions/orchestraitor.md). |
| L | [extensions/subagent/controller.mjs](../../extensions/subagent/controller.mjs), [extensions/subagent/child.mjs:18–28](../../extensions/subagent/child.mjs), [extensions/subagent/runtime.mjs:13–25](../../extensions/subagent/runtime.mjs). |

**M:** [status-ui.ts](../../extensions/status-ui.ts) delegates to [agents](../../extensions/ui/agents.ts), [tasks](../../extensions/ui/tasks.ts) and [questions](../../extensions/ui/questions.ts). It uses native widgets/status/dialogs, not header/footer/editor factories. Task state comes only from successful active-branch native receipts; it cannot grant writes, accept child work or recover execution. See the [UI guide](../interactive-ui.md). **N:** [bridge](../../extensions/ui/workbench-bridge.mjs), [contract](../../extensions/ui/workbench-contract.mjs) and [plugin actions](../../herdr/workbench/actions.mjs) separate disposable display state from native receipt authority. The [workbench guide](../herdr-workbench.md) owns activation and failure instructions; no question/command channel points back from the companion.

## The distinctions that prevent confusion

| Piece | What it actually is |
| --- | --- |
| Prompt | A reusable request. `/plan` does not start a separate planner agent. |
| Skill | Instructions and supporting resources, not an autonomous worker. See the [catalog](../skills.md). |
| Orchestraitor | The execution contract followed by the **main session**, not another process. |
| Subagent | A fresh worker with role `explore`, `review` or `implement`; launched only through `subagent_run`. |
| Plan | A Markdown contract: behavior, ordered groups, exact files, skills and checks. Not an executable scheduler. |
| `.ai/` | Planning/report artifacts; not a durable phase database. |

Sources: [prompts/plan.md:5–8](../../prompts/plan.md), [instructions/orchestraitor.md](../../instructions/orchestraitor.md), [extensions/subagents.ts](../../extensions/subagents.ts), [plan template:1–62](../../skills/execution-plan/assets/plan-template.md), [evidence-first-planning:26–37](../../skills/evidence-first-planning/SKILL.md).

## Supporting pieces, not extra SDD stages

- **Product inputs:** PRD, stories and buildable issues can clarify requirements. They do not automatically launch execution. Even `sdd-ready` is an issue label, not a running engine ([buildable-issue:27–49](../../skills/buildable-issue/SKILL.md)).
- **Specialist skills:** architecture, debugging, refactoring and testing guidance are loaded when relevant; they are not a mandatory chain. Plans select at most three implementation skills per group ([implementation-skill-routing:20–39](../../skills/implementation-skill-routing/SKILL.md)).
- **`/review`:** read-only findings; fixes need separate authorization. **`/absorb`:** compares another harness; does not adopt it ([review:5–8](../../prompts/review.md), [absorb:5–7](../../prompts/absorb.md)).
- **Installation and tests:** `scripts/install-pi.mjs` installs/migrates resources; package scripts expose verification. Neither is an SDD coordinator ([package.json](../../package.json), [README.md](../../README.md)).

## What is enforced, and what is instructed?

Planning-only scope, plan hashes, sequential groups and parent verification are **agent instructions**. Child tool/path restrictions have executable guards, but are **not an OS sandbox**. No durable SDD resume, automatic commits, TCR, parallel writers or blind dual review is supplied ([instructions/core.md:25](../../instructions/core.md), [instructions/orchestraitor.md](../../instructions/orchestraitor.md)).

Evidence method: local manifest, instructions and implementation; Graphify index absent. Context7 resolved Pi but its indexed versions do not establish 1.0.2 behavior, so installed public declarations/docs are the compatibility authority. Engram records verified project decisions, not task authority. Examples on the next pages are illustrative; current acceptance and limits belong in [verification](../verification.md).
