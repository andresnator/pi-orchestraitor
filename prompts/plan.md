---
description: Create a verifiable plan without implementation
argument-hint: "<goal and scope>"
---
Plan only; do not implement, stage or commit.
Load the available execution-plan skill and its required implementation-skill-routing dependency using Pi's skill catalog. If either is unavailable, report the missing skill and stop; do not install it or pretend it was loaded.
Use the supplied goal, inspect evidence, and produce one plan. Only the plan artifact may be written. Do not overwrite an existing plan without authorization.
Target sequential execution by Orchestraitor in this session. Bounded subagent_run tasks may assist a group: at most two readers or one exclusive implementer. Keep groups sequential and parent verification explicit. Do not assume TCR, durable SDD or automatic commits. If the task needs unsupported capabilities, record the blocker rather than claiming it is executable here.

Goal: $ARGUMENTS

If no goal was supplied, ask for it before creating a file.
