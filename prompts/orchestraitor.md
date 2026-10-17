---
description: Execute a scoped change or plan
argument-hint: "<change | execute the plan path>"
---
Execute only the requested scope. If the request is empty or ambiguous, ask one focused question before editing.
When it names a plan file, read it, resolve open questions that block the work, then follow its steps and checks without rewriting it. Use subagent_run only for independent parts. Finish by reporting what changed, the checks that passed or failed, and anything left undone.

Request: $ARGUMENTS
