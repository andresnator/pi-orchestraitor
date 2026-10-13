# BTW: temporary side conversations

`/btw` opens an empty panel. `/btw <question>` opens it and sends the question immediately, even while the main agent is working. The centered panel uses 70% of the terminal width and height.

**Closing discards everything:** answers, draft, search, and queue. An active request is cancelled, not left running in the background. Every new opening starts empty.

## Use

1. Reload Pi after updating the package.
2. Open `/btw` and ask questions. Follow-ups retain the side conversation only while the panel is open.
3. Press **Ctrl+Q** to close and discard, or submit **`/bring` inside BTW** to explicitly import a selection and close.

BTW snapshots the **current parent branch** on opening, respecting compaction and context edits. Each request uses the parent's **current model** when it starts; later changes do not affect an already running request. There are no separate model selectors, saved histories, other branches, or split views.

### Thinking and status

BTW answers with **low** thinking by default, so side questions stay fast while the parent works on harder settings. **Shift+Tab** cycles `low` → `inherit` → `off`; `inherit` follows the parent's level when each request starts. The title shows the choice and, when it differs, what the current model allows (`think inherit:high`, `think low→off`).

The title also reports the latest request:

| Phase | Example |
| --- | --- |
| Sending | `◌ Sending 0.4s` |
| Thinking | `◐ Thinking 3.4s · ~820 tok`; the latest reasoning appears under the pending answer, **Ctrl+T** hides it |
| Streaming | `◑ Streaming 3.1s · first token 1.1s · ~46 tok/s` |
| Done | `✓ Done 6.2s · first token 1.1s · cache 138k/142k · 812 tok` |
| Error / Cancelled | `✖ Error after 2.3s` / `■ Cancelled after 0.9s` |

`~` marks estimates from visible text; Done uses the provider's reported usage. In narrow panels the title drops request details before the phase, queue, or thinking level, and the footer keeps sending and closing hints.

### Prompt cache

BTW replays the parent's system prompt and tool declarations unchanged and sends its own instructions once, with the first side question. The request therefore starts with the parent's exact prefix, so providers with prefix caching can reuse the parent's cache, and follow-ups reuse BTW's own. The provider's default cache retention applies, as for the parent. Expected limits:

- BTW keeps its own provider session identity, so providers that route caching by session, such as OpenAI Codex, may miss on the first question and hit on follow-ups.
- Anthropic models with budget-based thinking key the message cache on the thinking settings; `inherit` maximizes reuse there.
- Extensions that rewrite the parent's context before each request make the prefixes differ.

## Controls

| Control | Action |
| --- | --- |
| Enter | Send; while responding, queue in FIFO order |
| Shift+Enter | Insert a newline |
| Shift+Tab | Cycle BTW thinking: low, inherit, off |
| Ctrl+T | Show or hide the reasoning preview |
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

- BTW never executes tools: it cannot run commands or modify files. The parent's tool declarations are replayed only to keep the prompt cache prefix; if the model asks for a tool anyway, BTW shows a notice, keeps any text, and never replays the call. This is a model-tool boundary, not an OS sandbox.
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

The BTW cases use fake providers and Pi's native TypeScript/peer mapping. They cover context isolation, the replayed parent prefix, thinking levels, status phases, tool-request notices, model inheritance, FIFO, cancellation, disposal during streaming, empty reopening, explicit imports, Mermaid, search, focus, resize, and terminal bounds. Package tests cover registration, excluding a standalone copy, and dependency-backed loading from extracted tarballs. They do not replace visual acceptance in a real terminal or a live provider check.
