import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createWorkspace, packageRoot } from "./helpers/pi-host.mjs";

test("shouldProduceIsolatedComparableReceiptsWithoutLiveUsageWhenBenchmarkRuns", { timeout: 30000 }, async (t) => {
	// Given
	const cwd = await createWorkspace(t);
	const output = join(cwd, "benchmark.json");
	// When
	execFileSync(process.execPath, [join(packageRoot, "scripts/bench.mjs"), "--samples", "1", "--output", output],
		{ cwd: packageRoot, timeout: 25000, encoding: "utf8" });
	const report = JSON.parse(await readFile(output, "utf8"));
	// Then
	assert.deepEqual(Object.keys(report.modes), ["native", "package"]);
	assert.match(report.treeSha256, /^[a-f0-9]{64}$/);
	assert.ok(report.limitations.some(note => note.includes("No model or MCP requests")));
	assert.deepEqual(report.modes.package.samples[0].unchangedHookReads, { branch: 0, usage: 0, invocations: 35 });
	assert.equal(report.modes.package.samples[0].skills, 61);
	assert.equal(report.modes.native.samples[0].skills, 0);
	assert.ok(report.modes.package.samples[0].subagentResponse.compact.characters < report.modes.package.samples[0].subagentResponse.fullReceipt.characters);
	assert.ok(report.modes.package.summary.startupMs.median > 0);
});

test("shouldRejectUnboundedSamplesBeforeLoadingHostWhenBenchmarkArgumentsAreInvalid", () => {
	// Given / When / Then
	assert.throws(() => execFileSync(process.execPath, [join(packageRoot, "scripts/bench.mjs"), "--samples", "31"],
		{ cwd: packageRoot, encoding: "utf8", stdio: "pipe" }), /Samples must be between 1 and 30/);
});
