<!-- Modified for Pi by pi-orchestraitor. -->

# Behavioral Skill Evaluation (Conditional Pilot)

A bounded protocol to check whether a skill actually changes agent behavior. Model runs are stochastic and cost real money, so this is an exception tool, not a routine gate.

## When to Run

Run only when ALL of these hold:

- The skill is a high-impact discipline skill (it constrains how the agent works, not just what it knows).
- A reproducible agent failure was observed: a concrete session where the agent violated the skill's contract despite it being available.
- The failure can be restated as a task prompt that a fresh agent session can attempt.

Never run as a blanket CI gate, for cosmetic skill edits, or to "prove" a skill works in general.

## Protocol

1. **Define the scoring criteria first.** Before any run, write down the observable behaviors that count as pass/fail (e.g. "states one hypothesis before editing", "cites a fresh command result"). Criteria written after seeing outputs are invalid.
2. **No-guidance control.** Run the task in a fresh context WITHOUT the skill loaded. At least 3 runs.
3. **Skill arm.** Run the identical task in a fresh context WITH the skill loaded. At least 3 runs.
4. **Fresh context per run.** No shared history, no accumulated corrections; identical prompts across arms except for the skill's presence.
5. **Preserve raw receipts.** Store full, unedited transcripts under `.ai/skill-evals/<skill>/<YYYY-MM-DD>/` (control and skill arms separated). Summaries without receipts are not evidence.
6. **Score manually.** Apply the pre-written criteria to each transcript. Record per-run pass/fail per criterion.
7. **Report variance and cost.** Report frequencies per arm (e.g. "control 0/3, skill 2/3"), disagreement between runs, and total token/model cost of the pilot.

## Interpreting Results

- Report frequencies, never certainty: "the skill raised compliance from 0/3 to 3/3 on this task" — not "the skill guarantees X".
- High variance in the skill arm is itself a finding: the contract wording is not landing reliably; rewrite and re-run the same protocol.
- A skill that only passes with extra conversational nudging failed the evaluation.
- Feed results back as a normal skill change: edit the contract, bump `metadata.version`, and note the evaluation date and outcome in the change description.

## Boundaries

- Token greps over one run are not behavioral proof; do not promote them to verified behavior.
- Do not turn this protocol into a required step of skill creation or a CI stage; keep package checks structural and record relevant behavior checks separately.
- Receipts under `.ai/` are local tool state and never become managed repo artifacts.
