# BTW: temporary side conversations

`/btw` opens an empty panel. `/btw <question>` opens it and sends the question immediately, even while the main agent is working. The centered panel uses 70% of the terminal width and height.

**Closing discards everything:** answers, draft, search, and queue. An active request is cancelled, not left running in the background. Every new opening starts empty.

## Use

1. Reload Pi after updating the package.
2. Open `/btw` and ask questions. Follow-ups retain the side conversation only while the panel is open.
3. Press **Ctrl+Q** to close and discard, or submit **`/bring` inside BTW** to explicitly import a selection and close.

BTW snapshots the **current parent branch** on opening, respecting compaction and context edits. Each request uses the parent's **current model and thinking level** when it starts; later changes do not affect an already running request. There are no separate model selectors, saved histories, other branches, or split views.

## Controls

| Control | Action |
| --- | --- |
| Enter | Send; while responding, queue in FIFO order |
| Shift+Enter | Insert a newline |
| Ctrl+Q | Close, cancel, and discard everything |
| Esc / Pi's interrupt keybinding | Cancel the response and clear the queue; close if idle |
| Ctrl+F | Search; Esc leaves search |
| Enter / Shift+Enter in search | Next / previous match |
| PgUp / PgDn, Alt+Up / Alt+Down | Scroll answers |
| Alt+Home / Alt+End | Jump to the beginning / end |
| Click `↓ latest answer` | Jump to the end |

An error also discards queued questions. You can ask again without closing. Mouse controls require Pi's fullscreen mode.

## Import into the parent

Nothing is imported automatically. Submit one of these commands **inside the BTW panel**:

| Command | Imported content |
| --- | --- |
| `/bring` or `/bring latest` | Latest answer containing text |
| `/bring 3+` | Questions 3 onward, with their answers |
| `/bring 2-4` | Questions and answers 2 through 4 |
| `/bring all` | Entire currently open side conversation |

Import adds a visible parent message **without triggering another parent turn**, then closes BTW and discards the remainder. During streaming, only the available text is copied and the request is cancelled.

## Isolation and rendering

- BTW has no tools: it cannot execute commands or modify files. This is a model-tool boundary, not an OS sandbox.
- It writes no conversation files or local preferences; the old `pi-btw.json` is not read.
- Local discard does not delete any records retained by the model provider.
- Answers use the user's language; UI labels and diagnostics use English.
- Markdown, search, and Mermaid rendering remain local. Incomplete, malformed, oversized, or unsupported diagrams fall back to source code.
- `beautiful-mermaid@1.1.3` is a declared runtime dependency, not a Pi-provided peer. A local checkout requires `pnpm install --frozen-lockfile`; native Git/npm installations install runtime dependencies through Pi.

## Migrating a standalone copy

The package registers `extensions/btw/index.ts`. If you previously installed a global `extensions/btw/index.ts`, disable that original through `pi config` before reloading, so only one `/btw` command loads. Keep the original files for recovery. Remove the exclusion only after disabling the bundled BTW or removing the harness.

To disable bundled BTW without changing other harness features, exclude `extensions/btw/index.ts` from this package through `pi config`.

## Verification

```bash
node --test tests/btw-*.test.mjs
node --test tests/package.test.mjs
```

The 71 imported cases use fake providers and Pi's native TypeScript/peer mapping. They cover context isolation, model inheritance, FIFO, cancellation, disposal during streaming, empty reopening, explicit imports, Mermaid, search, focus, resize, and terminal bounds. Package tests cover registration, excluding a standalone copy, and dependency-backed loading from extracted tarballs. They do not replace visual acceptance in a real terminal or a live provider check.
