import assert from "node:assert/strict";
import test from "node:test";
import { loadUiModule } from "./helpers/ui-harness.mjs";

test("shouldPrioritizeKnownLocksThenInputThenAgentsWithoutRepeatingNativeCountersWhenChromeIsComposed", async (t) => {
	// Given
	const { workStatus } = await loadUiModule(t, "extensions/ui/display.ts");
	const inputs = [{ launchBlocked: true, awaitingInput: true, activeAgents: 2 }, { launchBlocked: false, awaitingInput: true, activeAgents: 2 },
		{ launchBlocked: false, awaitingInput: false, activeAgents: 2 }, { launchBlocked: false, awaitingInput: false, activeAgents: 0 }];
	// When
	const outcomes = inputs.map(workStatus);
	// Then
	assert.deepEqual(outcomes, ["Agents blocked", "Awaiting input", "Agents · 2 active", undefined]);
	assert.ok(outcomes.every((value) => !value || !/tokens|cost|context|model/i.test(value)));
});

test("shouldPreserveExistingSanitizationWhenTerminalTextIsUntrusted", async (t) => {
	// Given
	const { sanitizeDisplay } = await loadUiModule(t, "extensions/ui/display.ts");
	const text = "\x1b]52;c;secret\x07\x1b[31mUnicode 你好 🧪 é\x1b[0m\r\nlast\x00\x08\r\t cause";
	// When
	const display = sanitizeDisplay(text);
	// Then
	assert.equal(display, "Unicode 你好 🧪 é\nlast     cause");
	assert.ok(text.includes("\x1b]52"));
});

test("shouldPreserveLineFeedsAndPrintableBytesWhenSanitizingDisplay", async (t) => {
	// Given
	const { sanitizeDisplay } = await loadUiModule(t, "extensions/ui/display.ts");
	// When
	const outcomes = ["", "alpha\nbeta", "é 你好 é", "a\u009fb", "a\x7fb"].map(sanitizeDisplay);
	// Then
	assert.deepEqual(outcomes, ["", "alpha\nbeta", "é 你好 é", "ab", "ab"]);
});
