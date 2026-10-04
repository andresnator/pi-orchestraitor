---
description: Execute a scoped change or plan with Orchestraitor
argument-hint: "<change | execute the plan path>"
---
Use the Orchestraitor execution contract from the pi_orchestraitor_execution instructions. If those instructions are unavailable, stop and ask to enable this package's instructions extension.
Execute only the requested scope. If the request is empty or ambiguous, ask one focused question before editing. Use subagent_run for bounded tasks when useful; execute small changes directly. Do not start SDD.

Request: $ARGUMENTS
