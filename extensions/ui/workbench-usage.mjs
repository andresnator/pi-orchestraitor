import { MAX_MODEL_ROWS } from "./workbench-contract.mjs";
export const MAX_CODEX_MODELS = MAX_MODEL_ROWS;
const TOKEN_FIELDS = ["input", "output", "cacheRead", "cacheWrite"];
const zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
const valid = number => Number.isSafeInteger(number) && number >= 0;
const modelId = (provider, model) => provider === "openai-codex" && typeof model === "string" && model.length > 0 && model.length <= 200 && !/[\x00-\x1f\x7f-\x9f]/u.test(model);
function tokens(value) {
	if (!value || !TOKEN_FIELDS.every(key => valid(value[key]))) return undefined;
	const result = Object.fromEntries(TOKEN_FIELDS.map(key => [key, value[key]]));
	result.total = TOKEN_FIELDS.reduce((sum, key) => sum + result[key], 0);
	// Native getSessionStats ignores totalTokens and sums these four categories.
	if (!valid(result.total)) return undefined;
	return result;
}
function add(target, source) {
	for (const key of [...TOKEN_FIELDS, "total"]) {
		target[key] += source[key];
		if (!valid(target[key])) throw new Error("Session usage exceeds safe integer range");
	}
}
function equal(left, right) { return [...TOKEN_FIELDS, "total"].every(key => left[key] === right[key]); }

/** Never add child details to the native aggregate; use them only as attribution evidence. */
export function projectSessionUsage(entries) {
	const total = zero(), unattributed = zero(), unsupported = zero();
	const attribution = { parent: zero(), delegated: zero(), unattributed: zero() };
	const byModel = new Map();
	let complete = true;
	const credit = (provider, model, amount) => {
		if (provider !== "openai-codex") { add(unsupported, amount); return; }
		if (!modelId(provider, model)) { add(unattributed, amount); return; }
		if (!byModel.has(model)) byModel.set(model, zero());
		add(byModel.get(model), amount);
	};
	const seen = new Set();
	for (const entry of entries) {
		if (entry?.id !== undefined) { if (seen.has(entry.id)) continue; seen.add(entry.id); }
		let raw, provider, model, receipt;
		if (entry?.type === "usage") { raw = entry.usage; provider = entry.provider; model = entry.model; }
		else if (entry?.type === "compaction" || entry?.type === "branch_summary") raw = entry.usage;
		else if (entry?.type === "message") {
			receipt = entry.message;
			if (receipt?.role === "assistant") { raw = receipt.usage; provider = receipt.provider; model = receipt.responseModel ?? receipt.model; }
			else if (receipt?.role === "toolResult") raw = receipt.usage;
		}
		if (raw === undefined) {
			if (["usage", "compaction", "branch_summary"].includes(entry?.type) || receipt?.role === "assistant" || (receipt?.role === "toolResult" && receipt.toolName === "subagent_run")) complete = false;
			continue;
		}
		const amount = tokens(raw);
		if (!amount) throw new Error("Invalid recorded session usage categories");
		if (receipt?.isError || ["error", "aborted", "pending"].includes(receipt?.stopReason)) complete = false;
		add(total, amount);
		if (receipt?.role === "toolResult") {
			const details = receipt.toolName === "subagent_run" ? receipt.details : undefined;
			const children = details?.results?.map?.(child => ({ ...child, effectiveModel: child.effectiveModel ??
				(child.status === "completed" && child.terminated === true ? child.model : undefined) }));
			const breakdown = zero();
			const verified = details?.usageComplete === true && Array.isArray(children) && children.length > 0 && children.length <= 2 && children.every(child => {
				const childTokens = tokens(child?.usage);
				if (!childTokens || child.usageComplete !== true || typeof child.effectiveModel !== "string") return false;
				const split = child.effectiveModel.indexOf("/");
				if (split < 1 || split === child.effectiveModel.length - 1) return false;
				add(breakdown, childTokens);
				return true;
			}) && equal(breakdown, amount);
			if (verified) {
				for (const child of children) {
					const split = child.effectiveModel.indexOf("/");
					credit(child.effectiveModel.slice(0, split), child.effectiveModel.slice(split + 1), tokens(child.usage));
				}
				add(attribution.delegated, amount);
			} else { add(unattributed, amount); add(attribution.unattributed, amount); }
			if (details?.usageComplete !== true) complete = false;
		} else if (provider) { credit(provider, model, amount); add(attribution.parent, amount); }
		else { add(unattributed, amount); add(attribution.unattributed, amount); }
	}
	const rows = [...byModel].map(([model, usage]) => ({ model, usage }));
	const codex = rows.slice(0, MAX_CODEX_MODELS);
	const overflow = { count: Math.max(0, rows.length - MAX_CODEX_MODELS), usage: zero() };
	for (const row of rows.slice(MAX_CODEX_MODELS)) add(overflow.usage, row.usage);
	const codexTotal = zero();
	for (const row of rows) add(codexTotal, row.usage);
	return { total, codex, codexTotal, unattributed, unsupported, overflow, attribution, complete, context: { status: "unknown" } };
}

export function projectCurrentContext(reading, model) {
	if (model?.provider !== "openai-codex") return { status: "unsupported" };
	if (!reading || !valid(reading.tokens) || !valid(reading.contextWindow) || reading.contextWindow === 0 ||
		!Number.isFinite(reading.percent) || reading.percent < 0 || reading.percent > Number.MAX_SAFE_INTEGER) return { status: "unknown" };
	return { status: "estimated", tokens: reading.tokens, capacity: reading.contextWindow, percent: reading.percent };
}
