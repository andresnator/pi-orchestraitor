# Retro Layout

Choose a theme and update the skeleton's fonts together. Seriph's heading slot is `fonts.serif`; body slots are `sans` and `mono`. Confirm this against the installed theme if its version changes. Use `background: none` to expose the theme gradient and choose `colorSchema` explicitly (`dark`, `light`, or `auto` with both schemes checked).

Keep the CSS day tokens on `:root`, night overrides on `html.dark`, cover/intro overrides and `prefers-reduced-motion` guard. Pixel fonts are wider than VT323; shrinking every theme to one shared typography scale can introduce overflow.

- Assign one meaning each to `--accent-a` and `--accent-b`; preserve it in `.tx-*`, `.bd-*`, chips, stamps and diagram classes.
- Place a section badge after each slide separator: `<div class="stamp stamp-a">topic</div>`. Use `.stamp-both` when both topics apply.
- Optionally copy `assets/global-bottom.vue` and replace its empty credit with the explicitly supplied author. Attribution of source code remains in package provenance/notices regardless of deck credit.
- Put presenter notes in a trailing HTML comment within the slide.

## Fitting a diagram

Choose LR or TD based on the actual graph geometry. Try orientation, fence scale (often 0.4–0.6 for wide mono labels), node/rank spacing, concise labels with a separate caption, then a diagram-only slide with `class: diagram-center`. Do not cut meaningful content to satisfy an assumed orientation rule.

Use node classes `a`, `b`, `aux` from the palette setup instead of CSS variables in `classDef`. The selected Mermaid palette is read at render time; switching schemes may require a reload and fresh inspection.

For dense text, consider per-slide `class: text-sm` and smaller captions before restructuring. Inspect the last row/line near every edge after export; parsing and a working dev server do not establish that content fits.
