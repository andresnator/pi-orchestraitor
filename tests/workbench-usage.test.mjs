import assert from "node:assert/strict";
import test from "node:test";
import { pi, isolatedAgentDir } from "./helpers/pi-host.mjs";
import { projectSessionUsage, projectCurrentContext } from "../extensions/ui/workbench-usage.mjs";

const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
const usage = (input, output = 0, cacheRead = 0, cacheWrite = 0) => ({ input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite, cost });
const row = (input, output = 0, cacheRead = 0, cacheWrite = 0) => ({ input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite });
const assistant = (provider, model, tokens) => ({ role: "assistant", provider, model, api: "openai-responses", content: [], usage: tokens, stopReason: "stop", timestamp: Date.now() });

test("shouldReconcileAllNativeEntriesWhenBranchesAndCompactionArePresent", () => {
	// Given
	const manager = pi.SessionManager.inMemory("/tmp/workbench-synthetic");
	manager.appendMessage(assistant("openai-codex", "model-a", usage(2, 3, 4, 0)));
	const branch = manager.getLeafId();
	manager.appendMessage(assistant("other", "foreign", usage(5)));
	manager.branch(branch);
	manager.appendUsage("cache_warm", "openai-codex", "model-b", usage(7, 0, 0, 1));
	manager.appendCompaction("synthetic", branch, 10, undefined, false, usage(11));
	manager.appendMessage({ role: "toolResult", toolName: "subagent_run", toolCallId: "batch", isError: false, content: [], timestamp: Date.now(), usage: usage(13), details: { usageComplete: false } });
	// When
	const result = projectSessionUsage(manager.getEntries());
	const native = manager.getEntries().reduce((sum, entry) => sum + (entry.type === "message" ? entry.message.usage?.totalTokens ?? 0 : entry.usage?.totalTokens ?? 0), 0);
	// Then
	assert.equal(result.total.total, native);
	assert.deepEqual(result.codex.map(item => item.model), ["model-a", "model-b"]);
	assert.deepEqual(result.unattributed, row(24));
	assert.deepEqual(result.unsupported, row(5));
	assert.equal(result.complete, false);
});

test("shouldAttributeDelegatedAggregateOnceOnlyWhenChildBreakdownReconciles", () => {
	// Given
	const children = [{ effectiveModel: "openai-codex/a", usage: usage(2, 1), usageComplete: true }, { effectiveModel: "openai-codex/b", usage: usage(3, 0, 1), usageComplete: true }];
	const entry = { type: "message", id: "result-one", message: { role: "toolResult", toolName: "subagent_run", usage: usage(5, 1, 1), details: { usageComplete: true, results: children } } };
	// When
	const result = projectSessionUsage([entry, entry]);
	// Then
	assert.deepEqual(result.codex.map(item => [item.model, item.usage.total]), [["a", 3], ["b", 4]]);
	assert.deepEqual(result.total, row(5, 1, 1));
	assert.deepEqual(result.unattributed, row(0));
});

test("shouldRetainUnattributedAmountsWhenNestedOrMixedChildrenAreUnprovable", () => {
	// Given
	const entries = [
		{ type: "message", id: "mixed", message: { role: "toolResult", toolName: "subagent_run", usage: usage(8), details: { usageComplete: true, results: [{ effectiveModel: "openai-codex/a", usage: usage(3), usageComplete: true }, { effectiveModel: "other/b", usage: usage(5), usageComplete: true }] } } },
		{ type: "message", id: "nested", message: { role: "toolResult", toolName: "subagent_run", usage: usage(10), details: { usageComplete: false, results: [{ effectiveModel: "openai-codex/a", usage: usage(10) }] } } },
	];
	// When
	const result = projectSessionUsage(entries);
	// Then
	assert.deepEqual(result.unattributed, row(10));
	assert.deepEqual(result.unsupported, row(5));
	assert.deepEqual(result.codexTotal, row(3));
	assert.equal(result.complete, false);
});

test("shouldNotInventModelAttributionWhenHistoricalChildDetailsAreMissing", () => {
	// Given
	const entries = [{ type: "message", id: "historical", message: { role: "toolResult", toolName: "subagent_run", usage: usage(6), details: { usageComplete: true } } },
		{ type: "message", id: "cancelled", message: { role: "toolResult", toolName: "subagent_run", usage: usage(1), isError: true, details: { usageComplete: false, results: [{ effectiveModel: "openai-codex/a", usage: usage(1) }] } } }];
	// When
	const result = projectSessionUsage(entries);
	// Then
	assert.deepEqual(result.unattributed, row(7));
	assert.deepEqual(result.total, row(7));
	assert.equal(result.complete, false);
});

test("shouldMatchActualNativeSessionStatsAcrossCompactionBranchAndFreshSession", async () => {
	// Given
	const manager = pi.SessionManager.inMemory("/tmp/workbench-synthetic");
	const settingsManager = pi.SettingsManager.inMemory({});
	const resourceLoader = new pi.DefaultResourceLoader({ cwd: "/tmp/workbench-synthetic", agentDir: isolatedAgentDir, settingsManager, noSkills: true, noThemes: true, noContextFiles: true, extensionFactories: [] });
	await resourceLoader.reload();
	const { session } = await pi.createAgentSession({ cwd: "/tmp/workbench-synthetic", agentDir: isolatedAgentDir, settingsManager, resourceLoader, sessionManager: manager });
	try {
		manager.appendMessage(assistant("openai-codex", "a", usage(2, 1, 4)));
		const first = manager.getLeafId();
		manager.appendUsage("cache_warm", "openai-codex", "b", usage(3));
		manager.branch(first);
		manager.appendCompaction("synthetic", first, 7, undefined, false, usage(5));
		manager.appendMessage({ role: "toolResult", toolName: "subagent_run", toolCallId: "child", content: [], isError: false, timestamp: Date.now(), usage: usage(9), details: { usageComplete: false } });
		// When
		const projected = projectSessionUsage(manager.getEntries());
		const fresh = pi.SessionManager.inMemory("/tmp/workbench-synthetic");
		// Then
		assert.deepEqual(projected.total, session.getSessionStats().tokens);
		assert.deepEqual(projectSessionUsage(fresh.getEntries()).total, row(0));
		assert.equal(projected.complete, false);
	} finally { session.dispose(); }
});

test("shouldPreferRecordedResponseModelWhenSelectedModelDiffers", () => {
	// Given
	const entry = { type: "message", id: "response-model", message: { ...assistant("openai-codex", "requested", usage(2)), responseModel: "effective" } };
	// When
	const result = projectSessionUsage([entry]);
	// Then
	assert.deepEqual(result.codex.map(item => item.model), ["effective"]);
});

test("shouldRetainAllTokensWhenMoreThanOneHundredCodexModelsAreRecorded", () => {
	// Given
	const entries = Array.from({ length: 102 }, (_, index) => ({ type: "usage", id: `usage-${index}`, provider: "openai-codex", model: `model-${index}`, usage: usage(index + 1) }));
	// When
	const result = projectSessionUsage(entries);
	// Then
	assert.deepEqual({ displayed: result.codex.length, overflow: result.overflow.count, total: result.total.total, codex: result.codexTotal.total }, { displayed: 100, overflow: 2, total: 5253, codex: 5253 });
	assert.equal(result.overflow.usage.total, 203);
});

test("shouldKeepMalformedModelAttributionSeparateFromUnsupportedProviders", () => {
	// Given
	const entries = [{ type: "usage", id: "bad-model", provider: "openai-codex", model: "bad\x1bmodel", usage: usage(1) },
		{ type: "usage", id: "foreign", provider: "other", model: "other-model", usage: usage(2) }];
	// When
	const result = projectSessionUsage(entries);
	// Then
	assert.deepEqual({ unattributed: result.unattributed.total, unsupported: result.unsupported.total, codex: result.codexTotal.total }, { unattributed: 1, unsupported: 2, codex: 0 });
});

test("shouldRetainNativeCategoriesWhenReportedTotalDiffersOrIsAbsent", () => {
	// Given
	const entries = [999, undefined].flatMap((totalTokens, index) => ["usage", "compaction", "branch_summary", "assistant", "toolResult"].map(type => {
		const record = { usage: { ...usage(2, 3, 4, 1), totalTokens } };
		return ["assistant", "toolResult"].includes(type) ? { id: `${index}-${type}`, type: "message", message: { ...record, role: type } } : { id: `${index}-${type}`, type, ...record };
	}));
	// When / Then
	assert.deepEqual(projectSessionUsage(entries).total, row(20, 30, 40, 10));
});

test("shouldUseConfirmedNativeChildModelAndKeepSeparateParentAttribution", () => {
	// Given
	const entries = [{ id: "p", type: "message", message: assistant("openai-codex", "a", usage(2)) },
		{ id: "c", type: "message", message: { role: "toolResult", toolName: "subagent_run", usage: usage(3), details: { usageComplete: true, results: [{ model: "openai-codex/a", status: "completed", terminated: true, usageComplete: true, usage: usage(3) }] } } }];
	// When
	const result = projectSessionUsage(entries);
	// Then
	assert.deepEqual(result.codex, [{ model: "a", usage: row(5) }]);
	assert.deepEqual(result.attribution, { parent: row(2), delegated: row(3), unattributed: row(0) });
});

for (const stopReason of ["error", "aborted", "pending"]) test(`shouldExposePartialConsumptionWhenAssistantIs${stopReason}`, () => {
	// Given / When
	const result = projectSessionUsage([{ type: "message", message: { ...assistant("openai-codex", "a", usage(2)), stopReason } }]);
	// Then
	assert.deepEqual(result.total, row(2));
	assert.equal(result.complete, false);
	assert.equal(projectSessionUsage([{ type: "usage" }]).complete, false);
});

test("shouldRejectInvalidCategoryRatherThanSilentlyDroppingNativeConsumption", () => {
	// Given / When / Then
	assert.throws(() => projectSessionUsage([{ type: "usage", usage: { ...usage(2), output: -1 } }]), /usage/i);
});

test("shouldDistinguishUnknownContextAndExplicitZeroFromSessionTotals", () => {
	// Given / When
	const unknown = projectCurrentContext(undefined, { provider: "openai-codex", id: "model-a" });
	const zero = projectCurrentContext({ tokens: 0, contextWindow: 200, percent: 0 }, { provider: "openai-codex", id: "model-a" });
	// Then
	assert.deepEqual(unknown, { status: "unknown" });
	assert.deepEqual(zero, { status: "estimated", tokens: 0, capacity: 200, percent: 0 });
	assert.deepEqual(projectCurrentContext(zero, { provider: "other" }), { status: "unsupported" });
});
