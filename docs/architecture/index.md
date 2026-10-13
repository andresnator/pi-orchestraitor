# Harness architecture

Pi owns sessions, provider selection, native tool execution, trust, keybindings, and model/context display. The package supplies instructions/personality, skills, prompts, compact native tools, BTW, NaN and optional MCP integration. The pinned pi-subagents companion is the sole delegation engine.

| Responsibility | Source |
| --- | --- |
| Parent execution and acceptance | [Orchestraitor instructions](../../instructions/orchestraitor.md) |
| Native specialists | [Agent definitions](../../agents/scout.md) and [subagent contract](../subagents.md) |
| Native child lifecycle, artifacts, Fleet and cost | pi-subagents@0.78.0 |
| Tasks and questions | [status-ui.ts](../../extensions/status-ui.ts), ui/tasks.ts and ui/questions.ts |
| SDK discovery and reversible installation | [installer](../../scripts/install-pi.mjs), pi-host.mjs and subagents-config.mjs |
| Temporary conversation | [BTW](../btw.md) |

The retired engine, role profiles, guards and agents projection are removed. Tasks project successful branch receipts; they cannot accept child work or recover execution. Child completion never marks tasks done. [Execution](execution.md) explains the initial reader/worker/reviewer flow; [native subagents](../subagents.md) states limits and pending acceptance.
