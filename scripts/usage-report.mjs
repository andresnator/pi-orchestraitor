// Read-only report over native Pi session logs: usage, prompt-cache misses, ceremony turns, codemode output and context residency.
// Emits metadata only (names, counts, sizes and native usage), never message, tool, script or path content.
import { open, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

const VERSION = 1;
const USAGE = "Usage: pnpm run usage [--sessions DIR|FILE] [--cwd PATH] [--since DATE] [--until DATE] [--json] [--output FILE] [--compare FILE]";
// Pi's dist/core/cache-stats.js is not exported: same TTL hint and per-request noise floor.
const CACHE_TTL_MS = 5 * 60 * 1000;
const NOISE_FLOOR_TOKENS = 1024;
// Pi's compaction estimate for one image; text uses characters/4.
const IMAGE_CHARACTERS = 4800;
const TASKS_TOOL = "orchestraitor_tasks";
const SUBAGENT_TOOLS = new Set(["subagent_run", "subagent_collect"]);
const OPTIONS_LINE = /^[ \t]*\/\/ @options:(.*)$/m;
const TRUNCATED = /^Warning: truncated output \(original token count: (\d+)\)/m;
const SPILL = /\[Full output: (.+) \(read with offset\/limit\)\]/;
// Sources a codemode script or its nested calls reference; one result can reference several.
const SOURCES = [
	["pi-docs", /pi-coding-agent\/(?:docs\/|examples\/|README\.md)/],
	["pi-dist", /@earendil-works\/[\w.-]+\/dist\//],
	["context7", /context7|resolve.library|query.docs/i],
	["engram", /engram|\bmem_[a-z_]+/i],
];
const ABOUT_PI = /earendil|pi-coding-agent/i;
// Tool, model, role and kind names become report keys; anything else is replaced so content never becomes a key.
const NAME = /^[\w.:@/+-]{1,128}$/;
const METHOD = [
	"Metadata only: names, counts, sizes and native usage. Message, tool, script and path content is never emitted.",
	"Usage is summed once from assistant messages, usage entries, compaction/branch summaries and top-level tool-result usage. details.results usage only attributes that aggregate and is never added.",
	"Incomplete accounting (usageComplete false, invalid usage or uncollected background readers) makes totals a lower bound, never a zero. A background child left pending in one selected session counts as collected when another, such as a fork, collects it.",
	"--since/--until select entries by their own timestamp; usage belongs to the entry that reports it, so a background child collected after --until counts in the later window.",
	"Every counted assistant request is a turn; per-turn usage, cost and cache figures divide by the turns that recorded valid usage.",
	"Model time is Pi's durationMs or, in logs written before Pi recorded it, the assistant entry time minus the request start (message.timestamp). Tool time exists only where Pi recorded durationMs; timedResults counts those results.",
	"Sessions are read oldest first. A fork copies its parent's entries with their ids and timestamps; a copy counts only when no older selected session holds it, and is otherwise replayed as state only.",
	"Cache misses follow Pi's cache-stats rule along each request's parentId branch rather than file order. Cold starts after session start, compaction or branch summary are reported separately.",
	"estimatedTokens use characters/4 (images 4,800 characters). Residency spreads each request's paid prompt price over its estimated model-visible history, honoring compaction and context edits; the system prompt and tool declarations stay unattributed.",
	"Codemode results count under every source their script or nested calls reference, so source shares overlap.",
];

const num = value => (Number.isFinite(value) ? value : 0);
const label = value => (typeof value === "string" && NAME.test(value) ? value : "(other)");
const modelKeyOf = record => `${label(record.provider)}/${label(record.model)}`;
const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
const newTool = () => ({ calls: 0, results: 0, errors: 0, resultCharacters: 0, estimatedTokens: 0, timedResults: 0, durationMs: 0 });
const validUsage = usage => Boolean(usage) && typeof usage === "object" && ["input", "output", "cacheRead", "cacheWrite"].every(key => Number.isFinite(usage[key]));
const promptOf = usage => usage.input + usage.cacheRead + usage.cacheWrite;
const promptCost = usage => num(usage.cost?.input) + num(usage.cost?.cacheRead) + num(usage.cost?.cacheWrite);
const bucket = (record, key, create) => (record[key] ??= create());
const textLength = value => (typeof value === "string" ? value.length : 0);
const isSystem = entry => entry.type === "message" && entry.message?.role === "system";
const isCeremony = name => name === TASKS_TOOL || name.startsWith("mem_");
function addUsage(total, usage) {
	for (const key of ["input", "output", "cacheRead", "cacheWrite", "reasoning", "totalTokens"]) total[key] += num(usage[key]);
	for (const key of Object.keys(total.cost)) total.cost[key] += num(usage.cost?.[key]);
	return total;
}
function contentCharacters(content) {
	if (typeof content === "string") return content.length;
	if (!Array.isArray(content)) return 0;
	return content.reduce((sum, block) => sum + (block?.type === "image" ? IMAGE_CHARACTERS : textLength(block?.text)), 0);
}
const contentText = content => (typeof content === "string" ? content : Array.isArray(content) ? content.map(block => (typeof block?.text === "string" ? block.text : "")).join("\n") : "");
function percentile(values, fraction) {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

/** Model-visible items of one entry as [kind, characters]; the system prompt and tools are the fixed prefix measured by the bench. */
function contextItems(entry, content) {
	if (entry.type === "compaction") return [["summary:compaction", textLength(entry.summary)]];
	if (entry.type === "branch_summary") return [["summary:branch", textLength(entry.summary)]];
	if (entry.type === "custom_message") return [[`custom:${label(entry.customType)}`, contentCharacters(content ?? entry.content)]];
	if (entry.type !== "message") return [];
	const message = entry.message ?? {}, body = content ?? message.content;
	if (message.role === "user") return [["user", contentCharacters(body)]];
	if (message.role === "toolResult") return [[`result:${label(message.toolName)}`, contentCharacters(body)]];
	if (message.role === "custom") return [[`custom:${label(message.customType)}`, contentCharacters(body)]];
	if (message.role === "bashExecution") return message.excludeFromContext ? [] : [["bash_execution", textLength(message.command) + textLength(message.output)]];
	if (message.role !== "assistant") return [];
	if (typeof body === "string") return [["assistant:text", body.length]];
	const items = [];
	let text = 0;
	for (const block of Array.isArray(body) ? body : []) {
		if (block?.type === "toolCall") items.push([`call:${label(block.name)}`, textLength(block.name) + (JSON.stringify(block.arguments ?? {}) ?? "").length]);
		else if (block?.type === "image") text += IMAGE_CHARACTERS;
		else text += textLength(block?.text) + textLength(block?.thinking);
	}
	return text ? [["assistant:text", text], ...items] : items;
}

/** History before a request on its branch, following Pi's latest-compaction and latest-context-edit projection. */
function requestContext(leaf) {
	const path = [];
	for (let node = leaf; node; node = node.parent) path.push(node);
	path.reverse();
	const edits = new Map();
	for (const { entry } of path) if (entry.type === "context_edit") edits.set(entry.targetId, entry.replacement);
	let selected = path;
	const last = path.findLastIndex(({ entry }) => entry.type === "compaction");
	if (last >= 0) {
		const kept = path.findIndex(({ id }) => id === path[last].entry.firstKeptEntryId);
		selected = [path[last], ...(kept >= 0 && kept < last ? path.slice(kept, last).filter(({ entry }) => !isSystem(entry)) : []), ...path.slice(last + 1)];
	}
	return selected.flatMap(node => (!edits.has(node.id) ? (node.items ??= contextItems(node.entry))
		: edits.get(node.id) === null ? [] : contextItems(node.entry, edits.get(node.id))));
}

const reset = cause => ({ prev: undefined, reset: cause, prompt: false, contextEdit: false });
const START = reset("start");

/** Cache state after an entry, as Pi's scan advances it; prompt and context-edit flags explain later misses. */
function advance(state, entry) {
	if (entry.type === "compaction" || entry.type === "branch_summary") return reset(entry.type);
	if (entry.type === "context_edit") return { ...state, contextEdit: true };
	if (isSystem(entry)) return { ...state, prompt: true };
	if (entry.type === "usage" && entry.kind === "cache_warm" && validUsage(entry.usage) && promptOf(entry.usage) > 0) {
		return { prev: { promptTokens: promptOf(entry.usage), modelKey: modelKeyOf(entry), timestamp: Date.parse(entry.timestamp),
			reportedCache: true, thinking: state.prev?.thinking }, reset: state.reset, prompt: false, contextEdit: false };
	}
	const message = entry.type === "message" ? entry.message : undefined;
	if (message?.role !== "assistant" || !validUsage(message.usage) || promptOf(message.usage) <= 0) return state;
	return { prev: { promptTokens: promptOf(message.usage), modelKey: modelKeyOf(message), timestamp: num(message.timestamp),
		reportedCache: (state.prev?.reportedCache ?? false) || message.usage.cacheRead + message.usage.cacheWrite > 0, thinking: message.thinkingLevel },
	reset: state.reset, prompt: false, contextEdit: false };
}

/** Pi's per-request miss rule; the cause is the first change found since the previous request on this branch. */
function classify(state, message) {
	const usage = message.usage, prompt = promptOf(usage), { prev } = state;
	if (prompt <= 0) return undefined;
	if (!prev) return { cold: state.reset, uncachedTokens: usage.input + usage.cacheWrite, uncachedCost: num(usage.cost?.input) + num(usage.cost?.cacheWrite) };
	if (usage.cacheRead + usage.cacheWrite === 0 && !prev.reportedCache) return undefined;
	const modelKey = modelKeyOf(message);
	const idle = Math.max(0, num(message.timestamp) - prev.timestamp) > CACHE_TTL_MS;
	const change = modelKey !== prev.modelKey ? "model"
		: message.thinkingLevel !== undefined && prev.thinking !== undefined && message.thinkingLevel !== prev.thinking ? "thinking"
			: state.prompt ? "prompt" : state.contextEdit ? "context_edit" : "none";
	const missedTokens = Math.min(prev.promptTokens, prompt) - usage.cacheRead;
	if (missedTokens <= NOISE_FLOOR_TOKENS) return { change, idle };
	const paid = usage.input + usage.cacheWrite;
	return { change, idle, miss: { cause: change !== "none" ? change : idle ? "idle" : "other", missedTokens, modelKey,
		paidPerToken: paid > 0 ? (num(usage.cost?.input) + num(usage.cost?.cacheWrite)) / paid : 0,
		readPerToken: usage.cacheRead > 0 ? num(usage.cost?.cacheRead) / usage.cacheRead : undefined } };
}

function createReport(options) {
	return { version: VERSION, recordedAt: new Date().toISOString(),
		window: { since: options.sinceMs === undefined ? null : new Date(options.sinceMs).toISOString(), until: options.untilMs === undefined ? null : new Date(options.untilMs).toISOString() },
		// Whether --cwd applied, never its path.
		filters: { cwd: Boolean(options.cwd) }, method: METHOD,
		sources: { files: 0, sessions: 0, forks: 0, entries: 0, inheritedEntries: 0, invalidLines: 0 },
		usage: { total: emptyUsage(), complete: true, assistant: emptyUsage(), usageEntries: {}, summaries: {}, toolResults: {},
			incomplete: { invalidUsage: 0, receipts: 0, children: 0, uncollected: 0 } },
		turns: { assistant: 0, withUsage: 0, user: 0, perUserMessage: null }, models: {},
		cache: { misses: { count: 0, missedTokens: 0, missedCost: 0, byCause: {} }, coldStarts: {}, transitions: {} },
		ceremony: { only: {}, batchedTurns: 0, calls: {} }, tools: {},
		codemode: { results: 0, characters: 0, estimatedTokens: 0, perTurnEstimatedTokens: null, bySource: {}, multiSource: { results: 0, characters: 0 },
			context7AboutPi: 0, options: { scripts: 0, maxOutputTokens: {} }, truncated: { results: 0, originalEstimatedTokens: 0, spillRereads: 0 } },
		residency: { promptCost: 0, attributedCost: 0, byItem: {} },
		subagents: { receipts: 0, children: 0, byRole: {} } };
}

function recordCodemode(report, message, details, call, spills) {
	const characters = contentCharacters(message.content), text = contentText(message.content), code = call?.code ?? "";
	const haystack = `${code}\n${JSON.stringify(details.calls ?? message.nestedCalls?.calls ?? [])}`;
	const matched = SOURCES.filter(([, pattern]) => pattern.test(haystack)).map(([name]) => name);
	const codemode = report.codemode;
	codemode.results++;
	codemode.characters += characters;
	for (const source of matched.length ? matched : ["other"]) {
		const record = bucket(codemode.bySource, source, () => ({ results: 0, characters: 0, samples: [] }));
		record.results++;
		record.characters += characters;
		record.samples.push(characters);
	}
	if (matched.length > 1) { codemode.multiSource.results++; codemode.multiSource.characters += characters; }
	if (call && report.models[call.modelKey]) report.models[call.modelKey].codemodeCharacters += characters;
	if (matched.includes("context7") && ABOUT_PI.test(haystack)) codemode.context7AboutPi++;
	const options = OPTIONS_LINE.exec(code);
	if (options) {
		codemode.options.scripts++;
		let limit;
		try { limit = JSON.parse(options[1]).max_output_tokens; } catch { limit = undefined; }
		const key = Number.isFinite(limit) ? String(limit) : "unset";
		codemode.options.maxOutputTokens[key] = (codemode.options.maxOutputTokens[key] ?? 0) + 1;
	}
	const truncated = TRUNCATED.exec(text);
	const spillPath = typeof details.fullOutputPath === "string" ? details.fullOutputPath : SPILL.exec(text)?.[1];
	if (!truncated && !spillPath) return;
	codemode.truncated.results++;
	codemode.truncated.originalEstimatedTokens += Number(truncated?.[1] ?? 0);
	if (spillPath) spills.push({ path: spillPath, reread: false });
}

/** Model time of one request: Pi's durationMs, or the entry time minus the request start in logs written before Pi recorded it. */
function durationOf(entry, message) {
	if (Number.isFinite(message.durationMs)) return message.durationMs;
	const elapsed = Date.parse(entry.timestamp) - message.timestamp;
	return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : undefined;
}

function recordAssistant(report, node, message, counted, track) {
	const toolCalls = Array.isArray(message.content) ? message.content.filter(block => block?.type === "toolCall") : [];
	const modelKey = modelKeyOf(message), usage = message.usage;
	for (const call of toolCalls) {
		track.calls.set(call.id, { modelKey, code: call.name === "codemode" && typeof call.arguments?.code === "string" ? call.arguments.code : "" });
		if (!counted) continue;
		const argumentsText = JSON.stringify(call.arguments ?? {}) ?? "";
		for (const spill of track.spills) if (!spill.reread && argumentsText.includes(spill.path)) { spill.reread = true; report.codemode.truncated.spillRereads++; }
	}
	if (validUsage(usage) && usage.cacheRead > 0) {
		const price = bucket(track.prices, modelKey, () => ({ tokens: 0, cost: 0 }));
		price.tokens += usage.cacheRead;
		price.cost += num(usage.cost?.cacheRead);
	}
	if (!counted) return;
	// A request without valid usage still counts as a turn; usage averages divide by the turns with usage.
	const valid = validUsage(usage);
	if (!valid) report.usage.incomplete.invalidUsage++;
	const names = toolCalls.map(call => label(call.name));
	report.turns.assistant++;
	const model = bucket(report.models, modelKey, () => ({ turns: 0, usageTurns: 0, timedTurns: 0, durationMs: 0, toolCalls: 0, codemodeCharacters: 0, usage: emptyUsage() }));
	model.turns++;
	model.toolCalls += names.length;
	const durationMs = durationOf(node.entry, message);
	if (durationMs !== undefined) { model.timedTurns++; model.durationMs += durationMs; }
	for (const name of names) bucket(report.tools, name, newTool).calls++;
	const ceremony = names.filter(isCeremony);
	for (const name of ceremony) report.ceremony.calls[name] = (report.ceremony.calls[name] ?? 0) + 1;
	if (names.length && ceremony.length === names.length) {
		const kind = ceremony.every(name => name === TASKS_TOOL) ? "tasks" : ceremony.every(name => name.startsWith("mem_")) ? "memory" : "mixed";
		const record = bucket(report.ceremony.only, kind, () => ({ turns: 0, cost: 0, durationMs: 0, byModel: {} }));
		const byModel = bucket(record.byModel, modelKey, () => ({ turns: 0, cost: 0, durationMs: 0 }));
		for (const target of [record, byModel]) { target.turns++; target.cost += valid ? num(usage.cost?.total) : 0; target.durationMs += durationMs ?? 0; }
	} else if (ceremony.length) report.ceremony.batchedTurns++;
	if (!valid) return;
	report.turns.withUsage++;
	model.usageTurns++;
	addUsage(report.usage.assistant, usage);
	addUsage(model.usage, usage);
	const event = classify(node.parent?.state ?? START, message);
	if (event?.cold) {
		const cold = bucket(report.cache.coldStarts, event.cold, () => ({ count: 0, uncachedTokens: 0, uncachedCost: 0 }));
		cold.count++;
		cold.uncachedTokens += event.uncachedTokens;
		cold.uncachedCost += event.uncachedCost;
	} else if (event) {
		const transition = bucket(report.cache.transitions, event.change, () => ({ requests: 0, misses: 0, idleRequests: 0, idleMisses: 0 }));
		transition.requests++;
		if (event.miss) { transition.misses++; track.misses.push(event.miss); }
		if (event.idle) { transition.idleRequests++; if (event.miss) transition.idleMisses++; }
	}
	const prompt = promptOf(usage);
	if (prompt <= 0) return;
	const price = promptCost(usage) / prompt;
	report.residency.promptCost += promptCost(usage);
	for (const [key, characters] of requestContext(node.parent)) {
		const item = bucket(report.residency.byItem, key, () => ({ estimatedTokenRequests: 0, estimatedCost: 0 }));
		item.estimatedTokenRequests += characters / 4;
		item.estimatedCost += (characters / 4) * price;
		report.residency.attributedCost += (characters / 4) * price;
	}
}

function recordToolResult(report, message, counted, track) {
	const details = message.details && typeof message.details === "object" ? message.details : {};
	const results = Array.isArray(details.results) ? details.results : [];
	for (const result of results) if (typeof result?.id === "string") track.collected.add(result.id);
	if (!counted) return;
	const name = label(message.toolName);
	if (Array.isArray(details.pending)) for (const item of details.pending) track.pending.add(typeof item === "string" ? item : item?.id);
	const characters = contentCharacters(message.content);
	const tool = bucket(report.tools, name, newTool);
	tool.results++;
	tool.resultCharacters += characters;
	if (Number.isFinite(message.durationMs)) { tool.timedResults++; tool.durationMs += message.durationMs; }
	if (message.isError) tool.errors++;
	if (message.usage !== undefined) {
		if (validUsage(message.usage)) addUsage(bucket(report.usage.toolResults, name, emptyUsage), message.usage);
		else report.usage.incomplete.invalidUsage++;
	}
	if (details.usageComplete === false) {
		const incomplete = results.filter(result => result?.usageComplete !== true).length;
		report.usage.incomplete.children += incomplete;
		if (!incomplete && !(Array.isArray(details.pending) && details.pending.length)) report.usage.incomplete.receipts++;
	}
	if (SUBAGENT_TOOLS.has(name) && results.length) {
		report.subagents.receipts++;
		for (const result of results) {
			if (typeof result?.id === "string") {
				if (track.children.has(result.id)) continue;
				track.children.add(result.id);
			}
			report.subagents.children++;
			const role = bucket(report.subagents.byRole, label(result?.role), () => ({ children: 0, usageComplete: 0, usage: emptyUsage() }));
			role.children++;
			if (result?.usageComplete === true) role.usageComplete++;
			if (validUsage(result?.usage)) addUsage(role.usage, result.usage);
		}
	}
	if (name === "codemode") recordCodemode(report, message, details, track.calls.get(message.toolCallId), track.spills);
}

function recordOther(report, entry) {
	if (entry.type === "message" && entry.message?.role === "user") { report.turns.user++; return; }
	const summary = (entry.type === "compaction" || entry.type === "branch_summary") && entry.usage !== undefined;
	if (entry.type !== "usage" && !summary) return;
	if (!validUsage(entry.usage)) { report.usage.incomplete.invalidUsage++; return; }
	addUsage(summary ? bucket(report.usage.summaries, entry.type, emptyUsage) : bucket(report.usage.usageEntries, label(entry.kind), emptyUsage), entry.usage);
}

/** Replays one session tree in file order; each entry's cache state derives from its parent, so every branch is exact. */
function analyzeSession(entries, fork, options, report, track) {
	const nodes = new Map();
	let previous, active = false;
	Object.assign(track, { calls: new Map(), spills: [], children: new Set() });
	entries.forEach((entry, index) => {
		const id = typeof entry.id === "string" ? entry.id : `#${index}`;
		const parent = "parentId" in entry ? (entry.parentId == null ? undefined : nodes.get(entry.parentId)) : previous;
		const node = { id, entry, parent, state: advance(parent?.state ?? START, entry) };
		nodes.set(id, node);
		previous = node;
		const time = Date.parse(entry.timestamp);
		// A fork copies its parent's entries with their ids and timestamps; an older session that holds a copy already counted it.
		const key = typeof entry.id === "string" ? `${entry.id}\n${entry.timestamp}` : undefined;
		const inherited = fork && track.seen.has(key);
		if (key !== undefined) track.seen.add(key);
		const counted = !inherited && Number.isFinite(time) && (options.sinceMs === undefined || time >= options.sinceMs) && (options.untilMs === undefined || time < options.untilMs);
		if (inherited) report.sources.inheritedEntries++;
		if (counted) { active = true; report.sources.entries++; }
		const role = entry.type === "message" ? entry.message?.role : undefined;
		if (role === "assistant") recordAssistant(report, node, entry.message, counted, track);
		else if (role === "toolResult") recordToolResult(report, entry.message, counted, track);
		else if (counted) recordOther(report, entry);
	});
	if (active) report.sources.sessions++;
}

function finalize(report, track) {
	const observedReadPrice = modelKey => (track.prices[modelKey]?.tokens ? track.prices[modelKey].cost / track.prices[modelKey].tokens : 0);
	const cache = report.cache.misses;
	for (const miss of track.misses) {
		// Pi reads the catalog price when a request read nothing from cache; offline, use the model's observed read price.
		const missedCost = miss.missedTokens * Math.max(0, miss.paidPerToken - (miss.readPerToken ?? observedReadPrice(miss.modelKey)));
		const cause = bucket(cache.byCause, miss.cause, () => ({ count: 0, missedTokens: 0, missedCost: 0 }));
		for (const target of [cache, cause]) { target.count++; target.missedTokens += miss.missedTokens; target.missedCost += missedCost; }
	}
	const usage = report.usage;
	usage.incomplete.uncollected = [...track.pending].filter(id => !track.collected.has(id)).length;
	for (const part of [usage.assistant, ...Object.values(usage.usageEntries), ...Object.values(usage.summaries), ...Object.values(usage.toolResults)]) addUsage(usage.total, part);
	usage.complete = Object.values(usage.incomplete).every(count => count === 0);
	const turns = report.turns.assistant;
	report.turns.perUserMessage = report.turns.user ? turns / report.turns.user : null;
	for (const model of Object.values(report.models)) {
		const prompt = promptOf(model.usage);
		model.cacheHitRatio = prompt ? model.usage.cacheRead / prompt : null;
		const priced = value => (model.usageTurns ? value / model.usageTurns : null);
		model.perTurn = { cost: priced(model.usage.cost.total), promptTokens: priced(prompt), outputTokens: priced(model.usage.output),
			durationMs: model.timedTurns ? model.durationMs / model.timedTurns : null, codemodeEstimatedTokens: model.codemodeCharacters / 4 / model.turns };
	}
	for (const tool of Object.values(report.tools)) tool.estimatedTokens = tool.resultCharacters / 4;
	const codemode = report.codemode;
	codemode.estimatedTokens = codemode.characters / 4;
	codemode.perTurnEstimatedTokens = turns ? codemode.estimatedTokens / turns : null;
	for (const source of Object.values(codemode.bySource)) {
		Object.assign(source, { estimatedTokens: source.characters / 4, share: codemode.characters ? source.characters / codemode.characters : null,
			p50Characters: percentile(source.samples, 0.5), p90Characters: percentile(source.samples, 0.9) });
		delete source.samples;
	}
	for (const role of Object.values(report.subagents.byRole)) role.cacheHitRatio = promptOf(role.usage) ? role.usage.cacheRead / promptOf(role.usage) : null;
	const residency = report.residency;
	residency.byItem = Object.fromEntries(Object.entries(residency.byItem).sort((a, b) => b[1].estimatedCost - a[1].estimatedCost)
		.map(([key, item]) => [key, { ...item, share: residency.promptCost ? item.estimatedCost / residency.promptCost : null }]));
	return report;
}

/** Session start from a log's first line, where Pi writes the header; NaN for anything else. */
async function startOf(path) {
	const handle = await open(path);
	try {
		// A header holds at most two paths.
		const { buffer, bytesRead } = await handle.read(Buffer.alloc(16_384), 0, 16_384, 0);
		const header = JSON.parse(buffer.toString("utf8", 0, bytesRead).split("\n", 1)[0]);
		return header?.type === "session" ? Date.parse(header.timestamp) : NaN;
	} catch {
		return NaN;
	} finally {
		await handle.close();
	}
}

async function sessionFiles(root, sinceMs) {
	if ((await stat(root)).isFile()) return [root];
	const files = [];
	const walk = async directory => {
		for (const item of await readdir(directory, { withFileTypes: true })) {
			const path = join(directory, item.name);
			if (item.isDirectory()) await walk(path);
			// Entries are appended, so a file last modified before --since holds no entry inside the window.
			else if (item.isFile() && item.name.endsWith(".jsonl") && (sinceMs === undefined || (await stat(path)).mtimeMs >= sinceMs)) files.push({ path, start: await startOf(path) });
		}
	};
	await walk(root);
	// Oldest first, so a parent precedes its forks; logs without a header follow by path.
	const order = ({ start }) => (Number.isFinite(start) ? start : Infinity);
	return files.sort((a, b) => order(a) - order(b) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map(({ path }) => path);
}

async function buildReport(options) {
	// Pending and collected children span sessions: a fork can collect what its parent left pending.
	const report = createReport(options), track = { misses: [], prices: {}, seen: new Set(), pending: new Set(), collected: new Set() };
	for (const path of await sessionFiles(options.sessions, options.sinceMs)) {
		let header, invalid = 0;
		const entries = [];
		for (const line of (await readFile(path, "utf8")).split("\n")) {
			if (!line.trim()) continue;
			let entry;
			try { entry = JSON.parse(line); } catch { invalid++; continue; }
			if (!entry || typeof entry !== "object") invalid++;
			else if (entry.type === "session") header ??= entry;
			else entries.push(entry);
		}
		const cwd = typeof header?.cwd === "string" ? resolve(header.cwd) : undefined;
		if (options.cwd && !(cwd === options.cwd || cwd?.startsWith(options.cwd + sep))) continue;
		report.sources.files++;
		report.sources.invalidLines += invalid;
		const fork = Boolean(header?.parentSession);
		if (fork) report.sources.forks++;
		analyzeSession(entries, fork, options, report, track);
	}
	return finalize(report, track);
}

const changeOf = (before, after) => ({ before: before ?? null, after: after ?? null,
	changePercent: Number.isFinite(before) && Number.isFinite(after) && before !== 0 ? 100 * (after / before - 1) : null });
function headline(report) {
	// Reports without withUsage counted only turns with valid usage.
	const turns = report.turns.assistant, withUsage = report.turns.withUsage ?? turns, perTurn = value => (withUsage ? value / withUsage : null);
	const per100 = value => (turns ? (100 * value) / turns : null), rate = record => (record?.requests ? record.misses / record.requests : null);
	return {
		costPerTurn: perTurn(report.usage.total.cost.total),
		promptTokensPerTurn: perTurn(promptOf(report.usage.assistant)),
		codemodeEstimatedTokensPerTurn: report.codemode.perTurnEstimatedTokens,
		tasksOnlyTurnsPer100: per100(report.ceremony.only.tasks?.turns ?? 0),
		ceremonyOnlyTurnsPer100: per100(Object.values(report.ceremony.only).reduce((sum, kind) => sum + kind.turns, 0)),
		missedCostPerTurn: perTurn(report.cache.misses.missedCost),
		thinkingChangeMissRate: rate(report.cache.transitions.thinking),
		unchangedMissRate: rate(report.cache.transitions.none),
		turnsPerUserMessage: report.turns.perUserMessage,
	};
}
function compareReports(before, report) {
	const previous = headline(before), current = headline(report);
	return { baseline: { recordedAt: before.recordedAt, window: before.window, filters: { cwd: Boolean(before.filters?.cwd) }, complete: before.usage?.complete ?? null },
		sameMethodology: before.version === report.version,
		metrics: Object.fromEntries(Object.keys(current).map(key => [key, changeOf(previous[key], current[key])])),
		models: Object.fromEntries(Object.entries(report.models).map(([key, model]) => [key, before.models?.[key]?.perTurn
			? Object.fromEntries(Object.keys(model.perTurn).map(metric => [metric, changeOf(before.models[key].perTurn[metric], model.perTurn[metric])]))
			: { unavailable: "Baseline has no turns for this model" }])),
		subagentCacheHitRatio: Object.fromEntries(Object.entries(report.subagents.byRole).map(([role, record]) => [role, changeOf(before.subagents?.byRole?.[role]?.cacheHitRatio, record.cacheHitRatio)])) };
}

function summary(report) {
	// A model whose turns all lack valid usage has no per-turn averages.
	const money = value => (Number.isFinite(value) ? `$${value.toFixed(Math.abs(value) < 1 ? 3 : 2)}` : "n/a");
	const tokens = value => (!Number.isFinite(value) ? "n/a" : value >= 1e6 ? `${(value / 1e6).toFixed(2)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}k` : String(Math.round(value)));
	const percent = value => (Number.isFinite(value) ? `${(100 * value).toFixed(1)}%` : "n/a");
	const { total } = report.usage, turns = report.turns.assistant, lines = [];
	lines.push(`Pi usage report v${report.version} (metadata only; estimated tokens = characters/4)`);
	lines.push(`Window ${report.window.since ?? "start"} to ${report.window.until ?? "now"}: ${report.sources.sessions} sessions${report.sources.forks ? ` (${report.sources.forks} forks)` : ""}, ${turns} assistant turns, ${report.turns.user} user messages`);
	lines.push(`Usage ${money(total.cost.total)}${report.usage.complete ? "" : " (lower bound: incomplete accounting)"}: input ${tokens(total.input)}, output ${tokens(total.output)}, cache read ${tokens(total.cacheRead)}, cache write ${tokens(total.cacheWrite)}`);
	for (const [key, model] of Object.entries(report.models).sort((a, b) => b[1].usage.cost.total - a[1].usage.cost.total)) {
		lines.push(`  ${key}: ${model.turns} turns, ${money(model.usage.cost.total)}; per turn ${money(model.perTurn.cost)}, prompt ${tokens(model.perTurn.promptTokens)}, cache hit ${percent(model.cacheHitRatio)}, ${model.perTurn.durationMs === null ? "duration n/a" : `${(model.perTurn.durationMs / 1000).toFixed(1)} s`}`);
	}
	const { misses } = report.cache;
	lines.push(`Cache misses (Pi rule): ${misses.count}, ${tokens(misses.missedTokens)} tokens, ${money(misses.missedCost)} extra`);
	for (const [cause, record] of Object.entries(misses.byCause).sort((a, b) => b[1].missedCost - a[1].missedCost)) lines.push(`  ${cause}: ${record.count}, ${tokens(record.missedTokens)} tokens, ${money(record.missedCost)}`);
	for (const [change, record] of Object.entries(report.cache.transitions)) lines.push(`  ${change === "none" ? "unchanged" : `after ${change} change`}: ${record.misses}/${record.requests} requests missed (${percent(record.requests ? record.misses / record.requests : null)})`);
	lines.push(`Cold starts: ${Object.entries(report.cache.coldStarts).map(([cause, record]) => `${cause} ${record.count} (${tokens(record.uncachedTokens)} uncached, ${money(record.uncachedCost)})`).join(", ") || "none"}`);
	const only = Object.entries(report.ceremony.only);
	lines.push(`Ceremony-only turns: ${only.map(([kind, record]) => `${kind} ${record.turns} (${percent(turns ? record.turns / turns : null)}, ${money(record.cost)}, ${(record.durationMs / 1000).toFixed(0)} s)`).join(", ") || "none"}; batched with work: ${report.ceremony.batchedTurns}`);
	const codemode = report.codemode;
	lines.push(`Codemode: ${codemode.results} results, ${tokens(codemode.estimatedTokens)} estimated tokens (${tokens(codemode.perTurnEstimatedTokens ?? 0)} per turn); @options in ${codemode.options.scripts}; truncated ${codemode.truncated.results} (spill rereads ${codemode.truncated.spillRereads})`);
	lines.push(`  by source (overlapping; ${codemode.multiSource.results} results reference several):`);
	for (const [source, record] of Object.entries(codemode.bySource).sort((a, b) => b[1].characters - a[1].characters)) lines.push(`    ${source}: ${record.results} results, ${percent(record.share)}, p50 ${tokens(record.p50Characters / 4)} / p90 ${tokens(record.p90Characters / 4)} tokens`);
	const residency = report.residency;
	lines.push(`Residency (estimated share of paid prompt ${money(residency.promptCost)}):`);
	for (const [key, item] of Object.entries(residency.byItem).slice(0, 8)) lines.push(`  ${key}: ${money(item.estimatedCost)} (${percent(item.share)})`);
	lines.push(`  unattributed (system prompt, tools, estimate error): ${money(residency.promptCost - residency.attributedCost)} (${percent(residency.promptCost ? 1 - residency.attributedCost / residency.promptCost : null)})`);
	const roles = Object.entries(report.subagents.byRole);
	if (roles.length) lines.push(`Subagents (attribution only): ${roles.map(([role, record]) => `${role} ${record.children}, cache hit ${percent(record.cacheHitRatio)}`).join("; ")}`);
	if (report.comparison) {
		lines.push(`Comparison with ${report.comparison.baseline.recordedAt}${report.comparison.sameMethodology ? "" : " (different methodology)"}:`);
		for (const [metric, change] of Object.entries(report.comparison.metrics)) lines.push(`  ${metric}: ${change.before === null ? "n/a" : change.before.toFixed(4)} -> ${change.after === null ? "n/a" : change.after.toFixed(4)}${change.changePercent === null ? "" : ` (${change.changePercent >= 0 ? "+" : ""}${change.changePercent.toFixed(1)}%)`}`);
	}
	return lines.join("\n");
}

function parseArgs(args) {
	const options = { sessions: join(homedir(), ".pi/agent/sessions") };
	// pnpm forwards a literal "--" separator to the script.
	const values = args.filter(arg => arg !== "--");
	for (let index = 0; index < values.length; index++) {
		const key = values[index];
		if (key === "--json") { options.json = true; continue; }
		const value = values[++index];
		if (!["--sessions", "--cwd", "--since", "--until", "--output", "--compare"].includes(key) || value === undefined || value.startsWith("--")) throw new Error(USAGE);
		options[key.slice(2)] = value;
	}
	for (const key of ["since", "until"]) if (options[key] !== undefined) {
		options[`${key}Ms`] = Date.parse(options[key]);
		if (!Number.isFinite(options[`${key}Ms`])) throw new Error(`Invalid --${key} date: ${options[key]}`);
	}
	if (options.sinceMs !== undefined && options.untilMs !== undefined && options.sinceMs >= options.untilMs) throw new Error("--since must be earlier than --until");
	if (options.cwd) options.cwd = resolve(options.cwd);
	return options;
}

async function main(args) {
	const options = parseArgs(args);
	if (options.output && await stat(options.output).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; })) {
		throw new Error(`Refusing to overwrite existing report: ${options.output}`);
	}
	const baseline = options.compare ? JSON.parse(await readFile(options.compare, "utf8")) : undefined;
	const report = await buildReport(options);
	if (baseline) report.comparison = compareReports(baseline, report);
	if (options.output) await writeFile(options.output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
	console.log(options.json ? JSON.stringify(report, null, 2) : summary(report));
}

try { await main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
