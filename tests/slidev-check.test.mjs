import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { extractMermaidBlocks, checkMarkdown } from "../skills/jag-slidev/assets/mermaid-check/check.mjs";

const checker = fileURLToPath(new URL("../skills/jag-slidev/assets/mermaid-check/check.mjs", import.meta.url));

test("shouldExtractBothFenceStylesWhenOptionsAndLongFencesAreUsed", () => {
	// Given
	const source = ["~~~mermaid {scale: 0.5}", "flowchart LR", "A-->B", "~~~", "", "````Mermaid", "sequenceDiagram", "````"].join("\n");
	// When
	const blocks = extractMermaidBlocks(source);
	// Then
	assert.deepEqual(blocks, [{ line: 1, code: "flowchart LR\nA-->B" }, { line: 6, code: "sequenceDiagram" }]);
});

test("shouldIgnoreNestedExamplesWhenTheyAreInsideOtherCodeFences", () => {
	// Given
	const source = ["````md", "```mermaid", "not a diagram", "```", "````"].join("\n");
	// When / Then
	assert.deepEqual(extractMermaidBlocks(source), []);
});

test("shouldRejectUnclosedAndEmptyDiagramsWhenExtractingFences", () => {
	// Given / When / Then
	assert.throws(() => extractMermaidBlocks("~~~mermaid\nflowchart LR"), /Unclosed Mermaid fence at line 1/);
	assert.throws(() => extractMermaidBlocks("```mermaid\n \n```"), /Empty Mermaid block at line 1/);
});

test("shouldReportAllParseFailuresWhenMultipleDiagramsAreChecked", async () => {
	// Given
	const source = "~~~mermaid\nBAD\n~~~\n```mermaid\nGOOD\n```";
	const seen = [];
	const parse = async (code) => { seen.push(code); if (code === "BAD") throw new Error("invalid diagram"); };
	// When
	const result = await checkMarkdown(source, { expected: 2, parse });
	// Then
	assert.deepEqual({ seen, result }, { seen: ["BAD", "GOOD"], result: {
		count: 2, failures: [{ line: 1, message: "invalid diagram" }],
	} });
});

test("shouldContinueCheckingWhenAParserRejectsWithANonErrorValue", async () => {
	// Given
	const source = "~~~mermaid\nA\n~~~\n~~~mermaid\nB\n~~~";
	let count = 0;
	// When
	const result = await checkMarkdown(source, { expected: 2, parse: () => { count++; throw null; } });
	// Then
	assert.deepEqual({ count, failures: result.failures }, { count: 2, failures: [
		{ line: 1, message: "Parser rejected diagram" }, { line: 4, message: "Parser rejected diagram" },
	] });
});

test("shouldRejectCountMismatchBeforeParsingWhenDiagramsAreMissing", async () => {
	// Given
	let called = false;
	// When / Then
	await assert.rejects(checkMarkdown("# No diagrams", { expected: 1, parse: () => { called = true; } }), /Expected 1 Mermaid blocks; found 0/);
	assert.equal(called, false);
});

test("shouldValidateZeroDiagramsWithoutDependenciesWhenExplicitlyExpected", async () => {
	// Given / When
	const result = await checkMarkdown("# Text only", { expected: 0 });
	// Then
	assert.deepEqual(result, { count: 0, failures: [] });
});

test("shouldGiveUsageAndFileErrorsWhenCliInputsAreInvalid", async (t) => {
	// Given
	const dir = await mkdtemp(join(tmpdir(), "slidev-check-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const input = join(dir, "slides with spaces.md");
	await writeFile(input, "# Text only");
	// When
	const run = (...args) => spawnSync(process.execPath, [checker, ...args], { encoding: "utf8" });
	const missingArgs = run();
	const missingFile = run(join(dir, "missing.md"), "--expect", "0");
	const mismatch = run(input, "--expect", "1");
	const success = run(input, "--expect", "0");
	// Then
	assert.deepEqual([missingArgs.status, missingFile.status, mismatch.status, success.status], [2, 2, 2, 0]);
	assert.match(missingArgs.stderr, /Usage:/);
	assert.match(success.stdout, /0 Mermaid blocks; no diagrams validated/);
	assert.equal(await readFile(input, "utf8"), "# Text only");
});
