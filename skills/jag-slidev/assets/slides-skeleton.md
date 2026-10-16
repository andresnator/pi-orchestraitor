---
theme: seriph
title: Deck title
# colorSchema selects the scheme of the chosen theme:
#   dark = night console, light = day console, auto = system + UI toggle
colorSchema: dark
transition: slide-left
# Font pairs per theme (see assets/themes/<name>/style.css):
#   crt-phosphor:     serif VT323           / sans+mono JetBrains Mono
#   dos-terminal:     serif Silkscreen      / sans+mono IBM Plex Mono
#   synthwave-arcade: serif Press Start 2P  / sans+mono Space Mono
fonts:
  serif: VT323
  sans: JetBrains Mono
  mono: JetBrains Mono
class: text-center
background: none
---

<div class="stamp stamp-both"><span class="tx-a">topic-a</span> <span class="opacity-60">×</span> <span class="tx-b">topic-b</span></div>

# Deck title

## <span class="tx-a">topic-a</span> × <span class="tx-b">topic-b</span>

One-line subtitle describing what connects the two topics

<div class="mt-10 flex gap-3 justify-center">
  <span class="chip chip-a">topic-a · its one-line role</span>
  <span class="chip chip-b">topic-b · its one-line role</span>
</div>

---

<div class="stamp stamp-b">topic-b</div>

# Content slide

Short lead-in sentence framing the slide.

- **Key point** — supporting detail
- **Key point** — supporting detail
- **Key point** — supporting detail

<!--
Presenter notes go in a trailing HTML comment inside the slide.
Expand on the bullets here; the audience never sees this.
-->

---
class: diagram-center
---

<div class="stamp stamp-a">topic-a</div>

# Diagram slide

```mermaid {scale: 0.5, flowchart: {nodeSpacing: 35, rankSpacing: 36}}
flowchart LR
  A["input"] --> B["process"] --> C["output"]
  class A a
  class B aux
  class C b
```

<!--
Node accents: `class <id> a|b|aux` — the classes are styled by the theme's
mermaid-setup.ts in the scheme-correct palette. No classDef in fences:
mermaid cannot parse var() there and hardcoded hexes break day/night.
-->


<div class="mt-2 text-xs opacity-80">Caption: move detail out of wide node labels into a line like this.</div>
