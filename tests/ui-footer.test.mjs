import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadUiModule, plainTheme, tui } from "./helpers/ui-harness.mjs";

const NOW = Date.UTC(2026, 9, 16, 12);
const OPUS = { provider: "claude-bridge", id: "claude-opus-5-5", name: "Claude Opus 5.5", reasoning: true };
const VIEW = {
	cwd: "~/Projects/pi-orchestraitor", branch: "develop", sessionName: undefined,
	tokens: { input: 2, output: 81, cacheRead: 0, cacheWrite: 16_000, cost: 0 }, cacheHitRate: 0,
	context: { percent: 1.6, window: 1_000_000, autoCompact: true },
	model: { provider: "claude-bridge", name: "Claude Opus 5.5", reasoning: true }, thinkingLevel: "xhigh",
	statuses: new Map(),
};
const RIGHT = "claude-bridge · Claude Opus 5.5  effort:xhigh";
const ANTHROPIC_HEADERS = {
	"anthropic-ratelimit-unified-status": "allowed",
	"anthropic-ratelimit-unified-5h-utilization": "0.5",
	"anthropic-ratelimit-unified-5h-reset": String(NOW / 1000 + 8760),
	"anthropic-ratelimit-unified-7d-utilization": "0.25",
	"anthropic-ratelimit-unified-7d-reset": String(NOW / 1000 + 259_200),
};

/** Right-align a model segment the way the footer pads its metrics line. */
const spread = (left, right, width) => `${left}${" ".repeat(width - left.length - right.length)}${right}`;

test("shouldRenderProjectAndContextBarWhenTheTerminalIsWide", async (t) => {
	// Given
	const { renderFooter } = await loadUiModule(t, "extensions/ui/footer.ts");
	// When
	const lines = renderFooter(VIEW, 100, plainTheme);
	// Then
	assert.deepEqual(lines, ["~/Projects/pi-orchestraitor (develop)",
		spread("──────── ctx 1.6%/1.0M (auto)  ↑2 ↓81 CH0%", RIGHT, 100)]);
});

test("shouldAddSessionNameAndCostWhenTheSessionHasThem", async (t) => {
	// Given
	const { renderFooter } = await loadUiModule(t, "extensions/ui/footer.ts");
	const view = { ...VIEW, sessionName: "footer", tokens: { ...VIEW.tokens, cost: 0.1234 } };
	// When
	const lines = renderFooter(view, 120, plainTheme);
	// Then
	assert.deepEqual(lines, ["~/Projects/pi-orchestraitor (develop) • footer",
		spread("──────── ctx 1.6%/1.0M (auto)  ↑2 ↓81 CH0% $0.123", RIGHT, 120)]);
});

test("shouldDropDetailInPriorityOrderWhenTheTerminalNarrows", async (t) => {
	// Given
	const { renderFooter } = await loadUiModule(t, "extensions/ui/footer.ts");
	const variants = [
		["──────── ctx 1.6%/1.0M (auto)  ↑2 ↓81 CH0%", RIGHT],
		["──────── ctx 1.6%/1.0M (auto)", RIGHT],
		["──────── ctx 1.6%/1.0M (auto)", "Claude Opus 5.5  effort:xhigh"],
		["ctx 1.6%/1.0M (auto)", "Claude Opus 5.5  effort:xhigh"],
		["ctx 1.6%/1.0M (auto)", "Claude Opus 5.5"],
	];
	// When
	const lines = variants.map(([left, right]) => renderFooter(VIEW, left.length + 2 + right.length, plainTheme)[1]);
	const truncated = renderFooter(VIEW, 10, plainTheme);
	// Then
	assert.deepEqual(lines, variants.map(([left, right]) => `${left}  ${right}`));
	assert.deepEqual(truncated, [tui.truncateToWidth("~/Projects/pi-orchestraitor (develop)", 10, "…"),
		tui.truncateToWidth("ctx 1.6%/1.0M (auto)  Claude Opus 5.5", 10, "…")]);
});

test("shouldShowUnknownContextWithoutEffortWhenUsageIsUnknownAndTheModelDoesNotReason", async (t) => {
	// Given
	const { renderFooter } = await loadUiModule(t, "extensions/ui/footer.ts");
	const view = { ...VIEW, context: { percent: null, window: 272_000, autoCompact: false }, model: { ...VIEW.model, reasoning: false } };
	// When
	const lines = renderFooter(view, 80, plainTheme);
	// Then
	assert.deepEqual(lines[1], spread("──────── ctx ?/272k  ↑2 ↓81 CH0%", "claude-bridge · Claude Opus 5.5", 80));
});

test("shouldAddSortedSanitizedStatusesWhenExtensionsReportThem", async (t) => {
	// Given
	const { renderFooter } = await loadUiModule(t, "extensions/ui/footer.ts");
	const view = { ...VIEW, statuses: new Map([["orchestraitor:status", "Agents · 2 active"], ["a-foreign", "Foreign\tstatus\x1b[31m\n"]]) };
	// When
	const lines = renderFooter(view, 100, plainTheme);
	// Then
	assert.deepEqual(lines[2], "Foreign status Agents · 2 active");
});

test("shouldReadPlanLimitsWhenProvidersReportThemInResponseHeaders", async (t) => {
	// Given
	const { parseUsageLimits } = await loadUiModule(t, "extensions/ui/quota.ts");
	const codex = {
		"X-Codex-Primary-Used-Percent": "42", "x-codex-primary-window-minutes": "300", "x-codex-primary-reset-after-seconds": "8760",
		"x-codex-secondary-used-percent": "3", "x-codex-secondary-window-minutes": "10080", "x-codex-secondary-reset-at": String(NOW / 1000 + 259_200),
	};
	const unrelated = { "anthropic-ratelimit-unified-5h-utilization": "", "x-codex-primary-used-percent": "n/a", "content-type": "text/event-stream" };
	// When
	const outcomes = [ANTHROPIC_HEADERS, codex, unrelated].map((headers) => parseUsageLimits(headers, NOW));
	// Then
	assert.deepEqual(outcomes, [
		[{ label: "5h", percent: 50, resetsAt: NOW + 8_760_000 }, { label: "7d", percent: 25, resetsAt: NOW + 259_200_000 }],
		[{ label: "5h", percent: 42, resetsAt: NOW + 8_760_000 }, { label: "7d", percent: 3, resetsAt: NOW + 259_200_000 }],
		[],
	]);
});

/** Drive the footer extension with the events Pi emits, against a context the test controls. */
async function footerHarness(t, mode = "tui") {
	const { default: footer } = await loadUiModule(t, "extensions/footer.ts");
	const handlers = new Map();
	const factories = [];
	footer({ on: (event, handler) => handlers.set(event, handler), getSettings: () => ({ compaction: { enabled: true } }) });
	const state = { model: OPUS, leaf: "a", stale: false, entries: [{ type: "message", message: { role: "assistant",
		usage: { input: 2, output: 81, cacheRead: 0, cacheWrite: 16_000, cost: { total: 0 } } } }] };
	// Pi's context getters throw once the session is replaced.
	const live = (value) => { if (state.stale) throw new Error("stale ctx"); return value; };
	const ctx = {
		mode, cwd: join(homedir(), "Projects", "pi-orchestraitor"),
		get model() { return live(state.model); },
		get thinkingLevel() { return live("xhigh"); },
		getContextUsage: () => live({ tokens: 16_000, contextWindow: 1_000_000, percent: 1.6 }),
		sessionManager: { getSessionId: () => "session", getLeafId: () => state.leaf, getSessionName: () => undefined, getEntries: () => state.entries },
		ui: { setFooter: (factory) => factories.push(factory) },
	};
	const emit = (type, fields = {}) => handlers.get(type)({ type, ...fields }, ctx);
	emit("session_start", { reason: "startup" });
	const footerData = { getGitBranch: () => "develop", getExtensionStatuses: () => new Map(), onBranchChange: () => () => {} };
	const component = factories[0]?.({ requestRender() {} }, plainTheme, footerData);
	return { state, emit, factories, render: (width) => component.render(width) };
}

test("shouldShowProviderModelAndTotalsWhenTheFooterIsInstalled", async (t) => {
	// Given
	const { factories, render } = await footerHarness(t);
	// When
	const lines = render(100);
	// Then
	assert.deepEqual({ installed: factories.length, lines }, { installed: 1, lines: ["~/Projects/pi-orchestraitor (develop)",
		spread("──────── ctx 1.6%/1.0M (auto)  ↑2 ↓81 CH0%", RIGHT, 100)] });
});

test("shouldRecountTotalsWhenTheSessionLeafMoves", async (t) => {
	// Given
	const { state, render } = await footerHarness(t);
	render(100);
	state.entries = [...state.entries, { type: "message", message: { role: "assistant",
		usage: { input: 1000, output: 19, cacheRead: 48_000, cacheWrite: 0, cost: { total: 0.5 } } } }];
	// When
	const unchangedLeaf = render(120)[1];
	state.leaf = "b";
	const movedLeaf = render(120)[1];
	// Then
	assert.match(unchangedLeaf, /↑2 ↓81 CH0% /);
	assert.match(movedLeaf, /↑1\.0k ↓100 CH98% \$0\.500 /);
});

test("shouldLeaveTheNativeFooterWhenTheModeHasNoTerminalUI", async (t) => {
	// Given
	// When
	const { factories } = await footerHarness(t, "rpc");
	// Then
	assert.equal(factories.length, 0);
});

test("shouldRenderNothingWhenTheSessionContextWasReplaced", async (t) => {
	// Given
	const { state, render } = await footerHarness(t);
	state.stale = true;
	state.leaf = "b";
	// When
	const lines = render(100);
	// Then
	assert.deepEqual(lines, []);
});
