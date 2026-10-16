# Setup and Verification

Use the existing deck's toolchain first. For a new deck, bundled manifests target Node >=22.19 and pnpm 12.9.1 with Slidev 52.x, Seriph 0.25.x and Playwright Chromium 1.x. These optional dependencies are not harness dependencies. Check actual installed versions and their documentation; the template alone does not establish compatibility.

## Authorized scaffold

After the user authorizes dependency setup in the chosen new directory, copy both files from `assets/scaffold/` there. Do not replace existing manifests or workspace configuration. The workspace template denies the browser package's build script by default. Installation needs registry access; browser installation is a separate download/approval decision. Never enable build scripts or run `pnpm approve-builds` without applicable authorization. Keep the resulting lockfile with the deck.

Use deck-local `pnpm exec slidev`, not `npx` or `pnpm dlx` fallback downloads. Do not run install or export commands against the installed skill directory. Fonts are not bundled: verify the actual font loader/network needs, request permission if needed, or select available local fallbacks and inspect the result.

## Mermaid checker

Copy **both** `assets/mermaid-check/check.mjs` and its `package.json` into a new owned scratch directory. With setup authorization, install its declared dependencies in that same directory. Node resolves ESM dependencies beside the helper, not from an arbitrary shell cwd. Keep its Mermaid version aligned with the deck's actual renderer; record any difference.

Run from the scratch directory using an absolute deck path and a count established while authoring:

```sh
node check.mjs "/absolute/deck/slides.md" --expect 2
```

The checker recognizes top-level fences indented by at most three spaces: three-or-more backticks or tildes, with a Mermaid info label and optional same-line options. It ignores nested examples inside other code fences. HTML comments and YAML frontmatter are not parsed: Mermaid-looking fences there can be counted despite not rendering. Do not use this helper as complete syntax evidence for such a deck. List/blockquote nesting, imported slide files and other Markdown/Vue-generated diagrams are also outside this subset: enumerate them separately or report syntax coverage incomplete, never silently exclude them from the deck's acceptance evidence. Prefer lowercase `mermaid` in decks even though the checker recognizes case variants.

- Exit 0: declared count matched and all discovered blocks parsed; count zero means no diagrams validated.
- Exit 1: at least one parser failure.
- Exit 2: usage, file, fence, count or dependency/setup failure.

No DOMPurify stub is used. This is syntax checking, not HTML sanitization or a sandbox. The helper does not evaluate deck JavaScript, but rendering a deck can: inspect supplied Vue/JS and remote resources before authorizing browser execution.

## Export

Only with installed tooling and authorized browser execution, from the deck directory:

```sh
pnpm exec slidev export slides.md --format png --output "/new/dedicated/export-directory" --timeout 90000
```

Verify installed CLI options for the requested scheme; use explicit scheme configuration and inspect the resulting colors. Do not reuse an output directory containing unrelated files: export may replace its contents. For iterative ranges, use a different owned directory. End with a full export, compare the expected slide count (accounting for click states if enabled) and inspect every PNG. Record failed or unavailable checks instead of treating file generation as visual acceptance.
