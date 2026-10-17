# Troubleshooting

Use only the row matching an observed failure. Re-run the affected check after a fix; never infer a successful export from a source edit.

| Symptom | Check and smallest remedy |
| --- | --- |
| Vite overlay instead of slide 1 | Inspect the actual error. Bundled Mermaid setups under `assets/themes/<theme>/mermaid-setup.ts` export a plain function without an undeclared `@slidev/types` import. Do not install dependencies just to silence an unexplained import. |
| Diagram parse error | Run the checker with the intended count. Replace unsupported CSS-variable `classDef` styling with the bundled node classes; verify against the actual Mermaid version. |
| Checker finds no diagrams | Check count, fence syntax and imports against [setup.md](setup.md). Zero blocks is not diagram validation. |
| Missing jsdom/Mermaid | Check that both helper files and authorized dependencies are in the same scratch directory. Report blocked setup rather than downloading automatically. |
| Missing Chromium | Inspect installed Playwright instructions and request download/build-script authorization. The bundled scaffold deliberately disables automatic browser builds. |
| Diagram retains old colors after toggling | Reload/re-render and inspect the requested scheme; existing diagrams may retain their first palette. |
| Cover or intro ignores colors | Preserve the chosen CSS file's cover/intro overrides; inspect both schemes used by the deck. |
| Overflow, wrong fonts or tiny labels | Follow [layout.md](layout.md), verify fonts actually loaded and inspect a new full PNG export. |
| Range export appears to replace other images | Keep iterative output separate; finish with a new full export. Do not experiment in a directory containing unrelated files. |
