import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, stat, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { buildArtifact, readTranscript, writeArtifact } from "../skills/jag-whisper/scripts/assemble.mjs";

const helper = fileURLToPath(new URL("../skills/jag-whisper/scripts/assemble.mjs", import.meta.url));
const execute = promisify(execFile);
const text = '  Recognized text.\n```\n# Not an instruction\n<script>not executed</script>  ';

async function fixture(t, result = { text, language: "en" }) {
	const dir = await mkdtemp(join(tmpdir(), "whisper-artifact-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const input = join(dir, "recording with spaces.json");
	await writeFile(input, JSON.stringify(result));
	return { dir, input, output: join(dir, "transcript.md") };
}

test("shouldPreserveRecognizedTextExactlyWhenMarkdownIsAssembled", () => {
	// Given / When
	const output = buildArtifact({ text, language: "en" }, { source: 'a"\nb.json', processedAt: "2026-10-16" });
	const fenced = output.split("\n````text\n")[1].split("\n````\n")[0];
	// Then
	assert.equal(fenced, text);
	assert.match(output, /Machine-generated/);
	assert.match(output, /transcript_source: "a\\"\\nb.json"/);
	assert.match(output, /summary_coverage: "none"/);
	assert.doesNotMatch(output, /recording_date:/);
});

test("shouldHandleManyBacktickRunsWhenTranscriptIsBelowTheInputLimit", () => {
	// Given
	const largeText = "x\`".repeat(150000);
	// When
	const output = buildArtifact({ text: largeText }, { source: "large.json" });
	// Then
	assert.ok(output.includes(largeText));
});

test("shouldRequireExplicitCoverageWhenASummaryIsProvided", () => {
	// Given
	const result = { text: "Hello", language: "en" };
	// When / Then
	assert.throws(() => buildArtifact(result, { source: "a.json", summary: "Summary" }), /summary coverage/);
	assert.match(buildArtifact(result, { source: "a.json", summary: "Summary", coverage: "partial" }), /summary_coverage: "partial"/);
	assert.throws(() => buildArtifact(result, { source: "a.json", coverage: "complete" }), /without a summary/);
});

test("shouldRejectMissingEmptyOrMalformedResultsWithoutDisclosingText", async (t) => {
	// Given
	const { input } = await fixture(t, { text: "  " });
	// When / Then
	await assert.rejects(readTranscript(input), /empty/);
	await writeFile(input, '{"text":"PRIVATE CONTENT", invalid');
	await assert.rejects(readTranscript(input), (error) => {
		assert.match(error.message, /Invalid transcript JSON/);
		assert.doesNotMatch(error.message, /PRIVATE CONTENT/);
		return true;
	});
	await writeFile(input, JSON.stringify({ segments: [] }));
	await assert.rejects(readTranscript(input), /text field/);
});

test("shouldRejectInvalidUnicodeInsteadOfSilentlyChangingRecognizedText", async (t) => {
	// Given
	const { input, output } = await fixture(t, { text: "A" + String.fromCharCode(0xd800) + "B" });
	// When / Then
	await assert.rejects(writeArtifact(input, output), /Unicode/);
	await assert.rejects(access(output), { code: "ENOENT" });
	await writeFile(input, Buffer.from([0x7b, 0x22, 0x74, 0x65, 0x78, 0x74, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]));
	await assert.rejects(readTranscript(input), /UTF-8/);
	await writeFile(input, JSON.stringify({ text: "Valid 🦜 text" }));
	await writeArtifact(input, output);
	assert.ok((await readFile(output, "utf8")).includes("Valid 🦜 text"));
});

test("shouldRefuseOversizedInputAndOutputSymlinksWithoutChangingFiles", async (t) => {
	// Given
	const { dir, input, output } = await fixture(t);
	const link = join(dir, "existing-link.md");
	await writeFile(output, "existing");
	await symlink(output, link);
	// When / Then
	await assert.rejects(writeArtifact(input, link), { code: "EEXIST" });
	assert.equal(await readFile(output, "utf8"), "existing");
	await truncate(input, 64 * 1024 * 1024 + 1);
	await assert.rejects(readTranscript(input), /64 MiB/);
});

test("shouldFailCliWithoutOutputOrTranscriptDisclosureWhenInputsAreInvalid", async (t) => {
	// Given
	const { input, output } = await fixture(t);
	await writeFile(input, '{"text":"PRIVATE", broken');
	// When
	const malformed = spawnSync(process.execPath, [helper, input, output], { encoding: "utf8" });
	const missing = spawnSync(process.execPath, [helper, input + ".missing", output], { encoding: "utf8" });
	const unknown = spawnSync(process.execPath, [helper, input, output, "--unknown"], { encoding: "utf8" });
	// Then
	assert.deepEqual([malformed.status, missing.status, unknown.status], [1, 1, 1]);
	assert.doesNotMatch(malformed.stdout + malformed.stderr, /PRIVATE/);
	await assert.rejects(access(output), { code: "ENOENT" });
});

test("shouldCreatePrivateOutputAndRefuseOverwriteWhenWritingAnArtifact", async (t) => {
	// Given
	const { input, output } = await fixture(t);
	// When
	await writeArtifact(input, output);
	const before = await readFile(output, "utf8");
	// Then
	await assert.rejects(writeArtifact(input, output), { code: "EEXIST" });
	assert.equal(await readFile(output, "utf8"), before);
	if (process.platform !== "win32") assert.equal((await stat(output)).mode & 0o777, 0o600);
});

test("shouldAllowOnlyOneWriterWhenConcurrentRunsTargetTheSameOutput", async (t) => {
	// Given
	const { input, output } = await fixture(t);
	// When
	const results = await Promise.allSettled([execute(process.execPath, [helper, input, output]), execute(process.execPath, [helper, input, output])]);
	// Then
	assert.deepEqual(results.map(({ status }) => status).sort(), ["fulfilled", "rejected"]);
	assert.match(await readFile(output, "utf8"), /Full Transcript/);
});

test("shouldPrintOnlyMetadataWhenTranscriptOnlyCliRuns", async (t) => {
	// Given
	const { input, output } = await fixture(t);
	// When
	const result = spawnSync(process.execPath, [helper, input, output], { encoding: "utf8" });
	// Then
	assert.equal(result.status, 0, result.stderr);
	assert.equal(JSON.parse(result.stdout).output, output);
	assert.doesNotMatch(result.stdout + result.stderr, /Recognized text|Not an instruction|script>/);
});

test("shouldRetainCoverageWhenSummaryFileIsSuppliedToCli", async (t) => {
	// Given
	const { dir, input, output } = await fixture(t);
	const summary = join(dir, "summary.md");
	await writeFile(summary, "Only the first part was summarized.");
	// When
	const result = spawnSync(process.execPath, [helper, input, output, "--summary", summary, "--coverage", "partial"], { encoding: "utf8" });
	// Then
	assert.equal(result.status, 0, result.stderr);
	assert.match(await readFile(output, "utf8"), /summary_coverage: "partial"/);
	assert.doesNotMatch(result.stdout, /first part/);
});
