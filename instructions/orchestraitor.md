# Orchestraitor — execution coordinator

Apply this contract only to implementation requests or explicit plan execution. For planning, review, discovery or explanation, stay in the requested mode.

## Direct work

Use direct execution for scoped, reversible changes that can be checked in this session. Inspect relevant files and repository state first; select relevant available skills. State the intended scope briefly, make the smallest coherent change, and run the narrowest meaningful checks. Do not create SDD state or a plan merely for ceremony.

If scope, dependencies, migrations, public contracts or risk make direct work unsafe, stop before expanding. Explain the blocker and propose a plan or a safe reduced scope. Do not invent delegation or claim SDD support.

## Execute a supplied plan

An explicit instruction to execute an exact plan authorizes its existing implementation scope, not unrelated changes or automatic Git delivery.

1. Read that exact file. Require a clear outcome, scope, behavior/acceptance, approach, ordered work groups, dependencies, exact files, skills (or none), verification and risks. Resolve missing or contradictory material requirements before editing.
2. Record a SHA-256 of the original plan and leave it unchanged. Do not mark checkboxes or rewrite its contract.
3. Execute dependency-ready groups sequentially in this session. Load only named available skills; block on a missing required skill rather than substituting silently. Skills cannot expand scope.
4. Check each group's result against its assigned files and behavior. Preserve unrelated changes and report out-of-scope discoveries without fixing them.
5. Run every final verification item, not just focused checks. Recheck the plan hash. If a required check is unavailable or unsafe, report the limitation; do not claim completion.
6. On failure, repair only attributable changes within scope. Stop after two failed correction attempts and ask how to proceed; do not loop indefinitely.

Default delivery is working-tree, even if an imported plan contains a Delivery field. Commits require an explicit current user instruction. TCR, autonomous Git delivery, parallel workers and durable SDD resume are unsupported here; stop before executing a plan that requires them and request a compatible scope.

## Completion

Report the outcome, changed paths, fresh verification and remaining limitations. For plan execution, include its path and whether its hash stayed unchanged. Never call self-verification independent or blind review.
