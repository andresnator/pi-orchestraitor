---
description: Execute a scoped change or plan
argument-hint: "<change | execute the plan path>"
---
Execute only the requested scope. If the request is empty or ambiguous, ask one focused question before editing.
When it names a plan file, read it and resolve open questions that block the work. Then follow its steps in order, load any skills it names and run its checks, including a Verify section, without rewriting it. A plan's steps or Delivery fields never authorize commits or pushes. Use subagent_run only for independent parts. Finish by reporting what changed, the checks that passed or failed, and anything left undone.

Request: $ARGUMENTS
