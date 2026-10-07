import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import {
	initTheme, KeybindingsManager, TUI_KEYBINDINGS, visibleWidth, BtwMarkdown,
	BtwPopup, LATEST_CONTROL, SideConversation, selectTranscript,
} from "./helpers/btw-harness.mjs";

const QUESTION = "Pregunta lateral";
const theme = { fg: (_color, text) => text };
const MODEL = { id: "main-model", provider: "test", reasoning: true };
const SEARCH_TRAILING_CONTEXT = "After\n\n".repeat(20);
before(() => initTheme("dark", false));

describe("exports", () => {
	const turns = [{ question: "One", answer: "First" }, { question: "Two", answer: "Second" }, { question: "Three", answer: "Third" }];

	it("shouldExportOnlyTheLatestAnswerWhenNoRangeIsRequested", () => {
		// Given / When / Then
		assert.equal(selectTranscript(turns), "Third");
	});

	it("shouldExportAnInclusiveRangeOrQuestionSuffixWhenRequested", () => {
		// Given
		const selected = "## Question 2\nTwo\n\n## Answer\nSecond\n\n---\n\n## Question 3\nThree\n\n## Answer\nThird";
		// When / Then
		assert.equal(selectTranscript(turns, "2-3"), selected);
		assert.equal(selectTranscript(turns, "2+"), selected);
		assert.ok(selectTranscript(turns, "all").includes("## Question 1\nOne"));
	});

	for (const selection of ["0+", "4+", "3-1", "1-9", "all garbage", "2"]) {
		it(`shouldRejectInvalidSelectionsWhenSelectionIs${selection}`, () => {
			// Given / When / Then
			assert.throws(() => selectTranscript(turns, selection));
		});
	}
});

describe("mermaid", () => {
	for (const source of [
		"graph LR\nA[Start] --> B[Finish]",
		"sequenceDiagram\nAlice->>Bob: Hello",
		"stateDiagram-v2\nIdle --> Active",
		"classDiagram\nAnimal <|-- Duck",
		"erDiagram\nCUSTOMER ||--o{ ORDER : places",
	]) {
		it(`shouldRenderUnicodeLocallyWhenTheFenceIsSupported: ${source}`, () => {
			// Given
			const markdown = new BtwMarkdown(theme);
			// When
			markdown.setText(`Before\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\nAfter`);
			const lines = markdown.render(100);
			// Then
			assert.match(lines.join("\n"), /[┌┐└┘╭╮│─]/);
			assert.ok(lines.join("\n").includes("Before"));
			assert.ok(lines.join("\n").includes("After"));
			assert.equal(lines.every(line => visibleWidth(line) <= 100), true);
		});
	}

	it("shouldTileWideDiagramsWithoutOverflowWhenTheTerminalIsNarrow", () => {
		// Given
		const markdown = new BtwMarkdown(theme);
		markdown.setText("```mermaid\ngraph LR\nA[Start] --> B[Finish]\n``` ");
		// When / Then
		for (const width of [1, 2, 8, 20, 40]) assert.equal(markdown.render(width).every(line => visibleWidth(line) <= width), true);
		assert.ok(markdown.render(100).join("\n").includes("Finish"));
	});

	for (const fence of ["~~~example `tag`", "~~~~example ``tag``"]) {
		it(`shouldKeepNestedMermaidAsCodeWhenTheOuterTildeFenceIs${fence}`, () => {
			// Given
			const markdown = new BtwMarkdown(theme);
			const closing = fence.match(/^~+/)[0];
			const source = `${fence}\n\`\`\`mermaid\ngraph LR\nA[Start] --> B[Finish]\n\`\`\`\n${closing}`;
			// When
			markdown.setText(source);
			const rendered = markdown.render(100).join("\n");
			// Then
			assert.ok(rendered.includes("graph LR"));
			assert.ok(rendered.includes("A[Start] --> B[Finish]"));
		});
	}

	it("shouldKeepUnsupportedAndIncompleteFencesAsSourceWhenRendering", () => {
		// Given
		const markdown = new BtwMarkdown(theme);
		// When
		markdown.setText("```mermaid\npie\n title Unsupported\n```\n\n```mermaid\ngraph LR\nA --> B");
		// Then
		assert.ok(markdown.render(80).join("\n").includes("Unsupported"));
		assert.ok(markdown.render(80).join("\n").includes("A --> B"));
	});
});

describe("mermaid rendering safety", () => {
	it("shouldRenderWithoutNetworkCallsWhenADiagramFenceIsPresent", (t) => {
		// Given
		const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Network forbidden"); });
		try {
			const markdown = new BtwMarkdown(theme);
			// When
			markdown.setText("```mermaid\ngraph TD\nA --> B\n```");
			markdown.render(80);
			// Then
			assert.equal(fetch.mock.calls.length, 0);
		} finally { fetch.mock.restore(); }
	});

	it("shouldReapplyTheThemeWhenCachedDiagramsAreInvalidated", () => {
		// Given
		let color = "\x1b[31m";
		const dynamicTheme = { fg: (_token, text) => color + text + "\x1b[0m" };
		const markdown = new BtwMarkdown(dynamicTheme);
		markdown.setText("```mermaid\ngraph TD\nA --> B\n```");
		const before = markdown.render(80).join("\n");
		// When
		color = "\x1b[32m";
		markdown.invalidate();
		// Then
		assert.ok(before.includes("\x1b[31m"));
		assert.ok(markdown.render(80).join("\n").includes("\x1b[32m"));
		assert.ok(!markdown.render(80).join("\n").includes("\x1b[31m"));
	});
});

function popupFixture(answer = Array.from({ length: 100 }, (_, index) => `Line ${index}`).join("\n\n")) {
	const tui = { terminal: { rows: 24 }, requestRender: mock.fn() };
	const response = { role: "assistant", content: [{ type: "text", text: answer }] };
	const streamSimple = mock.fn(() => (async function* () { yield { type: "done", message: response, reason: "stop" }; })());
	const ctx = { model: MODEL, modelRegistry: { streamSimple } };
	const conversation = new SideConversation(ctx, { messages: [] });
	const done = mock.fn();
	const popup = new BtwPopup(tui, theme, new KeybindingsManager(TUI_KEYBINDINGS), conversation, done);
	return { popup, tui, conversation, done };
}

describe("search and controls", () => {
	for (const [answer, query] of [
		["abcdefghijklmnopqrstuvwxyz0123456789ABCD", "abcdefghijklmnopqrstuvwxyz0123456789ABCD"],
		["alpha beta gamma delta epsilon zeta eta theta", "alpha beta gamma delta epsilon zeta eta theta"],
		["**alpha beta** gamma delta epsilon zeta eta theta", "alpha beta gamma delta epsilon zeta eta theta"],
		["> alpha beta gamma delta epsilon zeta eta theta", "alpha beta gamma delta epsilon zeta eta theta"],
		["- alpha beta gamma delta epsilon zeta eta theta", "alpha beta gamma delta epsilon zeta eta theta"],
		["```text\nabcdefghijklmnopqrstuvwxyz0123456789ABCD\n```", "abcdefghijklmnopqrstuvwxyz0123456789ABCD"],
		["中文 🧠 alpha beta gamma delta epsilon zeta eta theta", "中文 🧠 alpha beta gamma delta epsilon zeta eta theta"],
	]) {
		it(`shouldFindTheSameLogicalMatchWhenWrappedTextIs${answer}`, async () => {
			// Given
			const { popup } = popupFixture(`Before\n\n${answer}\n\n${SEARCH_TRAILING_CONTEXT}`);
			await popup.submit(QUESTION);
			popup.handleInput("\x06");
			popup.handleInput(query);
			// When
			const results = [40, 120, 40].map(width => popup.render(width));
			// Then
			assert.deepEqual(results.map(lines => ({ count: lines.join("\n").includes("1/1"),
				atMatch: lines[1].includes(query.slice(0, 8)) })), [
				{ count: true, atMatch: true }, { count: true, atMatch: true }, { count: true, atMatch: true },
			]);
		});
	}

	it("shouldMapDiagramMatchesToTheirTileWhenTheWidthChanges", () => {
		// Given
		const markdown = new BtwMarkdown(theme);
		markdown.setText("```mermaid\ngraph LR\nA[Start] --> B[Finish]\n```");
		// When
		const results = [3, 8, 20, 40, 100].map(width => {
			const rows = markdown.getSearchRows("Finish", width);
			const rendered = markdown.render(width);
			return { matches: rows.length, atLabel: rows.every(row => rendered[row]?.includes("F")) };
		});
		// Then
		assert.deepEqual(results, Array.from({ length: 5 }, () => ({ matches: 1, atLabel: true })));
	});

	it("shouldPreserveTableAndFollowingMatchesWhenTableColumnsResize", () => {
		// Given
		const markdown = new BtwMarkdown(theme);
		markdown.setText("| Key | Value |\n| --- | --- |\n| Some fairly long label | Needle |\n\nTrailing Needle text");
		// When
		const results = [20, 40, 100].map(width => {
			const rows = markdown.getSearchRows("Needle", width);
			return { matches: rows.length, visible: rows.every(row => markdown.render(width)[row]?.includes("Needle")) };
		});
		// Then
		assert.deepEqual(results, Array.from({ length: 3 }, () => ({ matches: 2, visible: true })));
	});

	for (const query of ["alpha beta gamma delta epsilon zeta eta theta", "abcdefghijklmnopqrstuvwxyz0123456789ABCD"]) {
		it(`shouldFindTheSameCellMatchWhenWrappedTableTextIs${query}`, () => {
			// Given
			const markdown = new BtwMarkdown(theme);
			markdown.setText(`| Text | Tag |\n| --- | --- |\n| ${query} | END |`);
			// When
			const results = [20, 120, 20].map(width => {
				const rows = markdown.getSearchRows(query, width);
				const rendered = markdown.render(width);
				return { matches: rows.length, atStart: rows.every(row => rendered[row]?.includes(query.slice(0, 5))) };
			});
			// Then
			assert.deepEqual(results, Array.from({ length: 3 }, () => ({ matches: 1, atStart: true })));
		});
	}

	for (const query of ["zzzz", "Needle"]) {
		it(`shouldScaleSearchWorkLinearlyWhenATableIsSearchedFor${query}`, (t) => {
			// Given
			const original = String.prototype.indexOf;
			const work = count => {
				const markdown = new BtwMarkdown(theme);
				markdown.setText("| Text | Tag |\n| --- | --- |\n" + Array.from({ length: count }, (_, index) =>
					`| row ${index} alpha beta gamma delta epsilon zeta eta theta Needle | END |`).join("\n"));
				markdown.getSearchRows(query, 20);
				let calls = 0;
				const indexOf = t.mock.method(String.prototype, "indexOf", function (...args) {
					calls++;
					return original.apply(this, args);
				});
				try { markdown.getSearchRows(query, 20); } finally { indexOf.mock.restore(); }
				return calls;
			};
			// When
			const small = work(100), large = work(200);
			// Then
			assert.ok(large <= small * 3, `Doubling rows used ${large} vs ${small} indexOf calls`);
		});
	}

	it("shouldKeepEmptyCellsAndSeparateTablesAlignedWhenSearching", () => {
		// Given
		const markdown = new BtwMarkdown(theme);
		markdown.setText("| First | Second |\n| --- | --- |\n| Needle | Needle |\n| | Needle |\n\n" +
			"| Third | Fourth |\n| --- | --- |\n| Needle | Other |\n\nTrailing Needle text");
		// When
		const results = [20, 120, 20].map(width => ({
			matches: markdown.getSearchRows("Needle", width).length,
			crossCell: markdown.getSearchRows("Needle Needle", width).length,
		}));
		// Then
		assert.deepEqual(results, Array.from({ length: 3 }, () => ({ matches: 5, crossCell: 0 })));
	});

	it("shouldKeepDiagramMatchesOnTheOriginalGlyphWhenLowercasingExpandsUnicode", () => {
		// Given
		const markdown = new BtwMarkdown(theme);
		markdown.setText("```mermaid\ngraph LR\nA[Start] --> B[" + "İ".repeat(10) + "Finish]\n```");
		// When
		const results = [1, 8, 20].map(width => {
			const rows = markdown.getSearchRows("Finish", width);
			const rendered = markdown.render(width);
			return { matches: rows.length, atGlyph: rows.every(row => rendered[row]?.includes("F")) };
		});
		// Then
		assert.deepEqual(results, Array.from({ length: 3 }, () => ({ matches: 1, atGlyph: true })));
	});

	it("shouldCountOccurrencesRatherThanRowsWhenMatchesShareALine", async () => {
		// Given
		const { popup } = popupFixture("Needle Needle");
		await popup.submit(QUESTION);
		popup.handleInput("\x06");
		popup.handleInput("needle");
		// When
		const first = popup.render(100).join("\n");
		popup.handleInput("\r");
		const second = popup.render(40).join("\n");
		// Then
		assert.deepEqual({ first: first.includes("1/2"), second: second.includes("2/2") }, { first: true, second: true });
	});

	it("shouldNotMatchAcrossLogicalLinesOrMessagesWhenSearching", async () => {
		// Given
		const { popup } = popupFixture("Alpha\nBeta");
		await popup.submit("Question ending");
		popup.handleInput("\x06");
		// When / Then
		for (const query of ["AlphaBeta", "endingAlpha"]) {
			popup.handleInput("\x15");
			popup.handleInput(query);
			assert.ok(popup.render(100).join("\n").includes("0/0"));
		}
	});

	for (const opening of ["```text", "~~~text"]) {
		it(`shouldRenderAssistantMarkdownIndependentlyWhenTheQuestionLeaves${opening}Open`, async (t) => {
			// Given
			const { popup } = popupFixture("```mermaid\ngraph LR\nA[Start] --> B[Finish]\n```");
			const render = t.mock.method(BtwMarkdown.prototype, "render");
			// When
			await popup.submit(`Explain this:\n${opening}\nhello`);
			popup.render(100);
			const content = render.mock.calls.flatMap(call => call.result).join("\n");
			// Then
			assert.deepEqual({ source: content.includes("graph LR"), label: content.includes("Start") },
				{ source: false, label: true });
		});
	}

	it("shouldFindTranscriptMatchesAndKeepTheDraftWhenSearching", async () => {
		// Given
		const { popup } = popupFixture();
		await popup.submit(QUESTION);
		popup.handleInput("Saved draft");
		popup.render(100);
		// When
		popup.handleInput("\x06");
		popup.handleInput("Line 20");
		const matched = popup.render(100).join("\n");
		popup.handleInput("\x1b");
		// Then
		assert.ok(matched.includes("Line 20"));
		assert.ok(matched.includes("1/1"));
		assert.ok(popup.render(100).join("\n").includes("Saved draft"));
	});

	it("shouldJumpToLatestWhenTheFooterControlIsClicked", async () => {
		// Given
		const { popup } = popupFixture();
		await popup.submit(QUESTION);
		popup.render(100);
		popup.handleInput("\x1b[1;3H");
		const lines = popup.render(100);
		const before = lines.join("\n");
		const footerRow = lines.findIndex(line => line.includes(LATEST_CONTROL));
		// When
		popup.handleMouse({ type: "click", button: "left", x: 3, y: footerRow, width: 100, height: lines.length });
		// Then
		assert.ok(before.includes(QUESTION));
		assert.ok(popup.render(100).join("\n").includes("Line 99"));
	});

	it("shouldNotImportOrCloseWhenCtrlBIsPressed", async () => {
		// Given
		const { popup, conversation, done } = popupFixture();
		await popup.submit(QUESTION);
		const turns = structuredClone(conversation.turns);
		// When
		popup.handleInput("\x02");
		// Then
		assert.equal(done.mock.calls.length, 0);
		assert.deepEqual(conversation.turns, turns);
		assert.ok(popup.render(100).length > 0);
	});

	it("shouldImportOnlyTheLatestAnswerAndEraseStateWhenBringIsSubmitted", async () => {
		// Given
		const { popup, conversation, done } = popupFixture();
		await popup.submit(QUESTION);
		const answer = conversation.turns[0].answer;
		// When
		await popup.submit("/bring");
		// Then
		assert.deepEqual(done.mock.calls.map(call => call.arguments), [[answer]]);
		assert.deepEqual({ turns: conversation.turns, pending: conversation.pending, screen: popup.render(100) },
			{ turns: [], pending: [], screen: [] });
	});

	for (const command of ["/model", "/thinking", "/manager", "/workspace", "/clear", "/delete"]) {
		it(`shouldRejectRemovedCommandsWhenGiven${command}`, async () => {
			// Given
			const { popup, conversation, done } = popupFixture();
			// When
			await popup.submit(command);
			// Then
			assert.deepEqual(conversation.turns, []);
			assert.equal(done.mock.calls.length, 0);
			assert.ok(popup.render(200).join("\n").includes("Available BTW command: /bring"));
		});
	}

	it("shouldKeepThePanelOpenWhenBringHasNoAnswer", async () => {
		// Given
		const { popup, done } = popupFixture();
		// When
		await popup.submit("/bring");
		// Then
		assert.equal(done.mock.calls.length, 0);
		assert.ok(popup.render(200).join("\n").includes("The side conversation has no answers yet."));
	});

	it("shouldReuseCompletedMarkdownWhenRenderingFollowups", async (t) => {
		// Given
		const { popup, conversation } = popupFixture();
		await popup.submit("First");
		popup.render(100);
		const render = t.mock.method(BtwMarkdown.prototype, "render");
		try {
			// When
			await popup.submit("Second");
			popup.render(100);
			const firstView = render.mock.calls[0].this;
			const firstLines = render.mock.calls[0].result;
			render.mock.resetCalls();
			popup.render(100);
			// Then
			assert.equal(render.mock.calls[0].this, firstView);
			assert.equal(render.mock.calls[0].result, firstLines);
			assert.equal(conversation.turns.length, 2);
		} finally { render.mock.restore(); }
	});
});
