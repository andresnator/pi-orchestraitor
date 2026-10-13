import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fitParts, formatProgress, formatThinking, thinkingPreview } from "./helpers/btw-harness.mjs";

const START = 10_000;
const progress = (fields) => ({ phase: "sending", startedAt: START, answerChars: 0, thinking: "", ...fields });
const usage = (input, cacheRead, output) => ({ input, output, cacheRead, cacheWrite: 0, totalTokens: input + cacheRead + output });

describe("status line", () => {
	for (const [name, value, now, expected] of [
		["Idle", undefined, START, "Ready"],
		["Sending", progress({}), START + 400, "◌ Sending 0.4s"],
		["Thinking", progress({ phase: "thinking", thinking: "x".repeat(3280) }), START + 3400, "◐ Thinking 3.4s · ~820 tok"],
		["StreamingBeforeARateIsMeaningful", progress({ phase: "streaming", firstTextAt: START + 1100, answerChars: 40 }), START + 1300,
			"◑ Streaming 1.3s · first token 1.1s"],
		["Streaming", progress({ phase: "streaming", firstTextAt: START + 1100, answerChars: 368 }), START + 3100,
			"◑ Streaming 3.1s · first token 1.1s · ~46 tok/s"],
		["Done", progress({ phase: "done", firstTextAt: START + 1100, endedAt: START + 6200, usage: usage(4000, 138_000, 812) }), START + 9000,
			"✓ Done 6.2s · first token 1.1s · cache 138k/142k · 812 tok"],
		["DoneWithoutUsage", progress({ phase: "done", endedAt: START + 500 }), START + 9000, "✓ Done 0.5s"],
		["Error", progress({ phase: "error", endedAt: START + 2300 }), START + 9000, "✖ Error after 2.3s"],
		["Cancelled", progress({ phase: "cancelled", endedAt: START + 900 }), START + 9000, "■ Cancelled after 0.9s"],
	]) {
		it(`shouldDescribeTheRequestWhenItIs${name}`, () => {
			assert.equal(formatProgress(value, now), expected);
		});
	}

	it("shouldShowWhatInheritResolvesToAndWhenTheModelClampsTheLevel", () => {
		assert.deepEqual([formatThinking("low", "low"), formatThinking("inherit", "high"), formatThinking("low", "off"), formatThinking("off", "off")],
			["low", "inherit:high", "low→off", "off"]);
	});

	it("shouldKeepRequiredPartsAndTheMostImportantOptionalPartsThatFit", () => {
		const parts = [{ text: "Enter: send" }, { text: "Shift+Tab: thinking", priority: 1 }, { text: "Ctrl+F: search", priority: 2 }, { text: "Ctrl+Q: close" }];
		assert.deepEqual([80, 45, 30, 5].map(width => fitParts(parts, width)), [
			"Enter: send · Shift+Tab: thinking · Ctrl+F: search · Ctrl+Q: close",
			// A lower-priority part still shows when a more important one cannot fit.
			"Enter: send · Ctrl+F: search · Ctrl+Q: close",
			"Enter: send · Ctrl+Q: close",
			"Enter: send · Ctrl+Q: close",
		]);
	});

	it("shouldKeepOnlyTheLatestReasoningOnOneLineForThePreview", () => {
		const preview = thinkingPreview(`First idea\n\n${"step ".repeat(100)}final thought`);
		assert.ok(preview.startsWith("…") && preview.endsWith("step final thought") && !preview.includes("\n"));
		assert.equal(preview.length, 241);
	});
});
