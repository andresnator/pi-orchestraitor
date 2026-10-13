import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { Container, CURSOR_MARKER, Editor, Input, matchesKey, ScrollView, stripTerminalSequences, truncateToWidth, type Component, type Focusable, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { LOADING_TEXT, SideConversation } from "./conversation.ts";
import { BtwMarkdown } from "./markdown.ts";
import { fitParts, formatThinking, progressParts, thinkingPreview, type StatusPart } from "./status.ts";
import { selectTranscript } from "./transcript.ts";

export const POPUP_HEIGHT_RATIO = 0.7;
export const POPUP_FRAME_ROWS = 4;
export const POPUP_BORDER_COLUMNS = 2;
export const MAX_EDITOR_ROWS = 3;
export const MIN_EDITOR_COLUMNS = 3;
const MARKDOWN_VIEWS_PER_TURN = 3;
// Reasoning previews render literally, so partial markup cannot restyle the panel.
const MARKDOWN_SYNTAX = /[\\`*_[\]#<>|~]/g;
export const WELCOME_TEXT = "Ask a question. BTW uses Pi's model and is discarded on close. Only /bring returns content to the main conversation.";
// Narrow panels drop numbered hints first, highest number first; sending and closing always show.
const IDLE_HINTS: StatusPart[] = [
	{ text: "Enter: send" }, { text: "Shift+Tab: thinking", priority: 1 }, { text: "Ctrl+F: search", priority: 2 },
	{ text: "/bring: import", priority: 3 }, { text: "Ctrl+Q: close and discard" },
];
const BUSY_HINTS: StatusPart[] = [
	{ text: "Esc: cancel" }, { text: "Enter: queue", priority: 1 }, { text: "Ctrl+T: thinking preview", priority: 2 }, { text: "Ctrl+Q: close and discard" },
];
export const FOOTER_HELP = IDLE_HINTS.map(hint => hint.text).join(" · ");
export const BUSY_HELP = BUSY_HINTS.map(hint => hint.text).join(" · ");
export const LATEST_CONTROL = "↓ latest answer";
/** Keeps elapsed time and speed current while a request runs. */
export const STATUS_TICK_MS = 250;

export class BtwPopup implements Component, Focusable {
	focused = true;
	private readonly editor: Editor;
	private readonly transcript = new Container();
	private readonly turnViews: BtwMarkdown[] = [];
	private readonly pendingView: BtwMarkdown;
	private readonly scroll: ScrollView;
	private readonly search = new Input({ prompt: "Search: " });
	private searching = false;
	private searchIndex = 0;
	private searchMatches: number[] = [];
	private disposed = false;
	private editorTop = 0;
	private editorHeight = 0;
	private editorSourceOffset = 0;
	private editorColumnOffset = 0;
	private footerTop = 0;
	private statusMessage = "";
	private showThinking = true;
	private ticker?: ReturnType<typeof setInterval>;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly keybindings: KeybindingsManager,
		private readonly conversation: SideConversation,
		private readonly done: (imported?: string) => void,
	) {
		this.pendingView = new BtwMarkdown(theme);
		this.scroll = new ScrollView(this.transcript, { follow: "end", overscroll: "contain" });
		this.editor = new Editor(tui, {
			borderColor: text => theme.fg("accent", text),
			selectList: {
				selectedPrefix: text => theme.fg("accent", text), selectedText: text => theme.fg("accent", text),
				description: text => theme.fg("muted", text), scrollInfo: text => theme.fg("dim", text), noMatch: text => theme.fg("warning", text),
			},
		});
		this.editor.onSubmit = text => { void this.submit(text); };
		this.editor.onChange = () => tui.requestRender();
		this.conversation.onChange = () => { this.syncTicker(); tui.requestRender(); };
	}

	private syncTicker(): void {
		if (this.conversation.busy && !this.disposed) {
			this.ticker ??= setInterval(() => this.tui.requestRender(), STATUS_TICK_MS);
			this.ticker.unref?.();
		} else {
			clearInterval(this.ticker);
			this.ticker = undefined;
		}
	}

	async submit(question: string): Promise<void> {
		question = question.trim();
		if (this.disposed || !question) return;
		if (question.startsWith("/")) {
			this.editor.setText("");
			try {
				if (/^\/bring(?:\s|$)/.test(question)) this.close(selectTranscript(this.conversation.turns, question.slice("/bring".length).trim() || "latest"));
				else throw new Error("Available BTW command: /bring latest|N+|N-M|all.");
			} catch (error) { this.statusMessage = error instanceof Error ? error.message : String(error); }
			this.tui.requestRender();
			return;
		}
		this.editor.setText("");
		this.statusMessage = "";
		this.scroll.scrollToEnd();
		await this.conversation.send(question);
	}

	private refreshConversation(): void {
		// Independent documents prevent an unfinished fence from consuming another message.
		// Each view retains its cache across streaming updates and followups.
		const latest = this.conversation.turns.length - 1;
		this.conversation.turns.forEach((turn, index) => {
			const messages = [
				`### Question ${index + 1}\n${turn.question}\n\n`,
				`### Assistant\n${turn.answer || (turn.note ? "" : this.placeholder(index === latest))}\n\n`,
				[turn.note ? `> ${turn.note}` : "", "---"].filter(Boolean).join("\n\n"),
			];
			messages.forEach((text, messageIndex) => {
				const view = this.turnViews[index * MARKDOWN_VIEWS_PER_TURN + messageIndex] ??= new BtwMarkdown(this.theme);
				view.setText(text);
			});
		});
		const queued = this.conversation.pending.map(question => `- ${question}`).join("\n");
		this.pendingView.setText(queued ? `### Queued\n${queued}` : this.turnViews.length ? "" : WELCOME_TEXT);
		this.transcript.children = [...this.turnViews, this.pendingView];
	}

	/** Pending answer text: the request's phase, or its latest reasoning when the preview is on. */
	private placeholder(latest: boolean): string {
		const progress = latest ? this.conversation.progress : undefined;
		if (progress?.phase !== "thinking") return LOADING_TEXT;
		const preview = this.showThinking ? thinkingPreview(progress.thinking).replace(MARKDOWN_SYNTAX, "\\$&") : "";
		return preview ? `> ${preview}` : "Thinking…";
	}

	handleInput(data: string): void {
		if (this.disposed) return;
		if (matchesKey(data, "ctrl+q")) { this.close(); return; }
		if (matchesKey(data, "ctrl+f")) { this.searching = !this.searching; this.tui.requestRender(); return; }
		if (matchesKey(data, "shift+tab")) { this.conversation.cycleThinking(); this.tui.requestRender(); return; }
		if (matchesKey(data, "ctrl+t")) { this.showThinking = !this.showThinking; this.tui.requestRender(); return; }
		if (this.searching) {
			if (matchesKey(data, "escape")) this.searching = false;
			else if (matchesKey(data, "enter") || matchesKey(data, "ctrl+g")) this.searchIndex++;
			else if (matchesKey(data, "shift+enter") || matchesKey(data, "ctrl+shift+g")) this.searchIndex--;
			else { const previous = this.search.getValue(); this.search.handleInput(data); if (previous !== this.search.getValue()) this.searchIndex = 0; }
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "escape") || this.keybindings.matches(data, "app.interrupt")) {
			if (this.conversation.busy) this.conversation.cancel(); else this.close();
			return;
		}
		if (matchesKey(data, "pageUp")) this.scroll.scrollBy(-Math.max(1, this.scroll.viewportHeight));
		else if (matchesKey(data, "pageDown")) this.scroll.scrollBy(Math.max(1, this.scroll.viewportHeight));
		else if (matchesKey(data, "alt+up")) this.scroll.scrollBy(-1);
		else if (matchesKey(data, "alt+down")) this.scroll.scrollBy(1);
		else if (matchesKey(data, "alt+home")) this.scroll.scrollToStart();
		else if (matchesKey(data, "alt+end")) this.scroll.scrollToEnd();
		else if (matchesKey(data, "shift+enter")) this.editor.insertTextAtCursor("\n");
		else if (matchesKey(data, "return")) { void this.submit(this.editor.getExpandedText()); }
		else this.editor.handleInput(data);
		this.tui.requestRender();
	}

	close(imported?: string): void {
		if (this.disposed) return;
		this.dispose();
		this.done(imported);
	}

	handleMouse(event: TuiMouseEvent) {
		if (this.disposed) return undefined;
		if ((event.type === "click" || event.type === "press") && event.y === this.footerTop && event.x <= LATEST_CONTROL.length + 1) {
			this.searching = false;
			this.scroll.scrollToEnd();
			return { handled: true, render: true };
		}
		if (event.type === "wheel") { this.scroll.scrollBy(event.wheelDelta ?? 0); return { handled: true, render: true }; }
		if (event.y >= this.editorTop && event.y < this.editorTop + this.editorHeight) {
			this.focused = true;
			this.editor.focused = !this.searching;
			const translated = { ...event, x: Math.max(0, event.x - this.editorColumnOffset), y: event.y - this.editorTop + this.editorSourceOffset,
				width: Math.max(1, event.width - this.editorColumnOffset * POPUP_BORDER_COLUMNS) };
			if (this.searching) this.search.handleMouse({ ...translated, y: 0 });
			else this.editor.handleMouse(translated);
			return { handled: true, focus: true, render: true };
		}
		return undefined;
	}

	render(width: number): string[] {
		if (this.disposed) return [];
		this.refreshConversation();
		const height = Math.max(1, Math.floor(this.tui.terminal.rows * POPUP_HEIGHT_RATIO));
		this.editorColumnOffset = height > POPUP_FRAME_ROWS ? POPUP_BORDER_COLUMNS / 2 : 0;
		const innerWidth = Math.max(1, width - this.editorColumnOffset * POPUP_BORDER_COLUMNS);
		const editorBudget = Math.max(1, Math.min(MAX_EDITOR_ROWS, height - POPUP_FRAME_ROWS - 1));
		this.editor.focused = this.focused && !this.searching;
		this.search.focused = this.focused && this.searching;
		const fullEditor = this.editor.render(Math.max(MIN_EDITOR_COLUMNS, innerWidth));
		const editorContent = fullEditor.slice(1, -1);
		const cursorRow = Math.max(0, editorContent.findIndex(line => line.includes(CURSOR_MARKER)));
		const start = Math.max(0, cursorRow - editorBudget + 1);
		const editorLines = this.searching ? this.search.render(innerWidth) : editorContent.slice(start, start + editorBudget);
		this.editorSourceOffset = start + 1;
		this.editorHeight = editorLines.length;
		const fit = (line: string) => truncateToWidth(line, Math.max(1, width), "", true);
		if (height <= POPUP_FRAME_ROWS) { this.editorTop = 0; this.footerTop = -1; return editorLines.slice(0, height).map(fit); }

		const bodyHeight = Math.max(0, height - POPUP_FRAME_ROWS - editorLines.length);
		const content = this.scroll.render(innerWidth);
		this.scroll.updateLayout(content.length, bodyHeight, () => this.tui.requestRender());
		if (this.searching && this.search.getValue()) {
			const query = this.search.getValue().toLocaleLowerCase();
			this.searchMatches = [];
			let rowOffset = 0;
			for (const view of [...this.turnViews, this.pendingView]) {
				this.searchMatches.push(...view.getSearchRows(query, innerWidth).map(row => rowOffset + row));
				rowOffset += view.render(innerWidth).length;
			}
			if (this.searchMatches.length) {
				this.searchIndex = ((this.searchIndex % this.searchMatches.length) + this.searchMatches.length) % this.searchMatches.length;
				this.scroll.scrollTo(this.searchMatches[this.searchIndex], { disableFollow: true });
			}
		} else this.searchMatches = [];
		const visible = content.slice(this.scroll.scrollTop, this.scroll.scrollTop + bodyHeight).map((line, offset) =>
			this.searching && this.searchMatches.includes(this.scroll.scrollTop + offset) ? this.theme.fg("warning", stripTerminalSequences(line)) : line);
		const border = (text: string) => this.theme.fg("border", text);
		const row = (text: string) => border("│") + truncateToWidth(text, innerWidth, "", true) + border("│");
		// Request details give way first, so the phase, queue, and thinking level stay visible.
		const [phase, ...details] = progressParts(this.conversation.progress, Date.now());
		const queued = this.conversation.pending.length ? [{ text: `${this.conversation.pending.length} queued` }] : [];
		const thinking = formatThinking(this.conversation.thinking, this.conversation.thinkingLevel);
		const title = ` ${fitParts([
			{ text: "/btw" }, { text: phase }, ...details.map((text, index) => ({ text, priority: index })), ...queued, { text: `think ${thinking}` },
		], innerWidth - 2)} `;
		this.editorTop = bodyHeight + 2;
		this.footerTop = this.editorTop + editorLines.length;
		const searchInfo = this.searching ? ` · ${this.searchMatches.length ? this.searchIndex + 1 : 0}/${this.searchMatches.length} · Enter/Shift+Enter` : "";
		const hints = this.statusMessage ? [{ text: this.statusMessage }] : this.conversation.busy ? BUSY_HINTS : IDLE_HINTS;
		const help = fitParts([{ text: `${LATEST_CONTROL}${searchInfo}` }, ...hints], innerWidth);
		return [
			border("╭") + truncateToWidth(this.theme.fg("accent", title), innerWidth, "", true) + border("╮"),
			...visible.map(row), ...Array.from({ length: bodyHeight - visible.length }, () => row("")),
			border(`├${"─".repeat(innerWidth)}┤`), ...editorLines.map(row), row(this.theme.fg("dim", help)),
			border(`╰${"─".repeat(innerWidth)}╯`),
		].slice(0, height).map(fit);
	}

	invalidate(): void { this.editor.invalidate(); this.scroll.invalidate(); this.search.invalidate(); }

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.focused = false;
		this.syncTicker();
		this.conversation.dispose();
		this.editor.onSubmit = undefined;
		this.editor.onChange = undefined;
		this.editor.setText("");
		this.editor.focused = false;
		this.search.setValue("");
		this.search.focused = false;
		this.searchMatches = [];
		this.statusMessage = "";
		this.transcript.clear();
		for (const view of this.turnViews) view.dispose();
		this.turnViews.length = 0;
		this.pendingView.dispose();
	}
}
