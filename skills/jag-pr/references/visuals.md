<!-- Adapted from Matt Pocock's pr and Dex Horthy/HumanLayer's show-me. Modified for Pi by pi-orchestraitor. -->

# Smallest Useful Visual

Choose the view that answers the reader's current question. Keep it next to the short text it supports; include only relevant boundaries and ordering.

| Question | View |
| --- | --- |
| How does the logic work? | Pseudocode, explicitly labeled as a sketch |
| What calls what? | Call tree |
| Who owns UI state or a module? | Component tree with relevant paths |
| Which files own responsibilities? | Shallow file tree |
| How do components exchange data? | Mermaid flow or sequence diagram, when supported |
| What changed in a familiar shape? | Focused diff sketch |
| Is most of the block new, or is order important? | Complete small block |

Example explanatory sketch, not an execution receipt:

```text
on(save)
  if content is unchanged
    return cached result
  write fresh content
```

Example responsibility sketch:

```text
src/
├── commands/   # parses actions
└── sessions/   # owns state
```

Identify omissions when they would hide ownership, order or side effects. Use plain text if Mermaid is unsupported. Never open a browser, render HTML or manufacture screenshots as part of this skill; any separate integration needs explicit scope and available tools.
