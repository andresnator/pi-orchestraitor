---
name: jag-slidev
description: "Create or refine Slidev presentations with retro themes; validate Mermaid and inspect exported slides before reporting completion. Use for Slidev decks, slides or retro-terminal presentations."
disable-model-invocation: true
license: MIT
compatibility: "Pi 1.3.0; Node >=22.19, pnpm 12, optional Slidev/Playwright and Mermaid checker dependencies."
metadata:
  author: andresnator
  adapted_by: pi-orchestraitor
  source: agents-orchestrator
  upstream_name: slidev-retro-deck
  source_revision: ea3158595b56d832e79b41c4c16175f45cd67ea2
  version: "2.0.1"
  pi_adaptation: "2.0.0"
  status: testing
  modification_notice: "Adapted for Pi with explicit setup authority, bounded validation and portable resources."
---

# Slidev Decks

Create or revise a Slidev deck, not a generic presentation in another format. Confirm the format if the request is ambiguous. Resolve bundled resources from this skill directory; keep generated decks in a user-approved directory, for example `.ai/slides/<name>/`, never inside the installed skill.

## Workflow

1. **Scope and authorization.** Reuse supplied audience, topic, output path, theme, scheme and author credit. Ask only for blocking gaps. Inspect existing deck files before changes; do not overwrite unrelated content. Loading this skill does not authorize dependency installation, lifecycle-script approval, browser downloads or server launch.
2. **Preflight.** Read [references/setup.md](references/setup.md) before scaffolding or running tools. Confirm Node/pnpm and deck-local dependencies/browser availability. Missing prerequisites stop the affected check; do not silently install them. Existing decks retain their package manager and dependency choices unless a change is authorized.
3. **Compose.** For a new retro deck, start from [assets/slides-skeleton.md](assets/slides-skeleton.md) and choose one theme below. Copy its CSS to the deck root and its Mermaid setup to `setup/mermaid.ts`. Read [references/layout.md](references/layout.md) when selecting fonts or fitting diagrams. Use one semantic meaning per accent across text, stamps and diagram nodes. Add author credit only when supplied.
4. **Check syntax.** Count the intended Mermaid fences and use the checker with an explicit expected count, including zero for text-only decks. Its supported subset and exit statuses are in setup guidance. A zero count is not diagram validation. Resolve parse/count errors before export.
5. **Verify appearance.** With authorized installed tooling, export a full set of PNGs into a new, dedicated output directory. Read **every exported PNG** using available image inspection, for each scheme the deck will use. Compare the slide count, check clipping, fonts, legibility, badges and final table rows; fix and re-export. Range exports are iteration-only and must not replace the final full export. No visual access or failed export means verification is **incomplete**, not a finished deck.

| Theme directory under `assets/themes/` | Heading / body fonts | Identity |
| --- | --- | --- |
| `crt-phosphor` | VT323 / JetBrains Mono | Green and amber CRT |
| `dos-terminal` | Silkscreen / IBM Plex Mono | DOS terminal |
| `synthwave-arcade` | Press Start 2P / Space Mono | Neon arcade |

Each theme includes day/night tokens and a reduced-motion guard; preserve both. The plain-function Mermaid setup requires no transitive type import. Node classes `a`, `b`, `aux` use the selected palette; avoid hardcoded diagram colors that defeat scheme changes. Live toggles need explicit reinspection, not an assumption of re-rendering.

## Delivery

Report deck path, theme/schemes, expected/parsed diagram count, exported/inspected slide counts, output directory and remaining defects. Separate syntax success from visual verification. Do not claim accessibility compliance or measured performance savings. Use [references/troubleshooting.md](references/troubleshooting.md) only for a matching failure; no automatic installation or publication.
