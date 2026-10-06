<!-- Adapted from Matt Pocock's writing-for-agents; modified for Pi by pi-orchestraitor. -->

# Writing for Agent Consumption

## Pointers and Branches

A context pointer names material and the condition for reading it. A skill description is one; a line in an agent instruction file is another. State one trigger per distinct branch, put the leading concept first, and remove synonyms that merely rename the same branch. Keep critical conditions inline; disclose material needed only on some branches.

Always-loaded material consumes context and attention. Human-only discoverability consumes cognitive load. Splitting a file earns its cost only when a genuinely separate branch or invocation needs it. Do not promise savings without a measured profile.

## Hierarchy and Co-location

Order material by immediate need: in-file steps, in-file reference, then disclosed reference. Keep a concept's definition, caveats and rules together. A linked reference needs a clear reading condition and a resolvable path. Loading a file inside the same conversation is not a fresh context boundary.

## Completion Criteria

Each step ends at a checkable condition. Prefer exhaustive local criteria such as “every affected interface has a cited check” over “understand the system.” Sharpen the criterion before hiding later steps. Split sequences only when observed premature completion justifies a real handoff boundary.

## Language and Guardrails

Use a recognizable leading concept only if its meaning is clear; an invented word costs a definition. State the positive target behavior, while retaining explicit hard prohibitions for authorization, safety, privacy and destructive operations. Pruning must preserve exceptions, negations and evidence qualifications.

## Pruning

Give each meaning one authoritative home. Inspect environment facts instead of copying cheap lookups into prose. Remove irrelevant or stale instructions, repeated meanings and no-op sentences only with a reason. A suspected no-op is model-relative: record it as an inference unless a bounded comparison supports it.

Do not confuse shorter prose with verified better behavior. Report both the structural evidence and the missing model evidence.
