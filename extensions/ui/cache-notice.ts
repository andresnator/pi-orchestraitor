import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Smaller contexts cost little to send again. Pi's own cache-miss notice uses the same token floor.
const MIN_TOKENS = 20_000;
// Cycling through models or levels settles before the check.
const SETTLE_MS = 1000;

type Selection = { model: string; thinking: string };
type Prices = { input: number; cacheRead: number; cacheWrite: number };

/** Warn before the next request re-bills a cached context under another model or thinking level. Only the UI sees it. */
export function registerCacheNotice(pi: ExtensionAPI, settleMs = SETTLE_MS) {
	// The selection of the latest request, or of a resumed session's last one. Pi picks it before each turn_start.
	let sent: Selection | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const cancel = () => { clearTimeout(timer); timer = undefined; };
	const check = (ctx: ExtensionContext) => {
		const next = selection(ctx);
		if (!ctx.hasUI || !sent || (next.model === sent.model && next.thinking === sent.thinking)) return;
		// Unknown right after compaction, when the next request is new content anyway.
		const tokens = ctx.getContextUsage()?.tokens;
		if (typeof tokens !== "number" || tokens < MIN_TOKENS) return;
		ctx.ui.notify(notice(sent, next, tokens, ctx.model?.cost), "warning");
	};
	const schedule = (ctx: ExtensionContext) => {
		cancel();
		timer = setTimeout(() => {
			timer = undefined;
			// A replaced session's context throws; that session has nothing left to warn about.
			try { check(ctx); } catch {}
		}, settleMs);
		timer.unref?.();
	};
	pi.on("session_start", (_event, ctx) => { cancel(); sent = selection(ctx); });
	pi.on("turn_start", (_event, ctx) => { sent = selection(ctx); });
	pi.on("model_select", (event, ctx) => { if (event.source !== "restore") schedule(ctx); });
	pi.on("thinking_level_select", (_event, ctx) => schedule(ctx));
	pi.on("session_shutdown", () => { cancel(); sent = undefined; });
}

function selection(ctx: ExtensionContext): Selection {
	return { model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "none", thinking: ctx.thinkingLevel ?? "off" };
}

function notice(sent: Selection, next: Selection, tokens: number, prices?: Prices) {
	const changes = [];
	if (next.model !== sent.model) changes.push(`Model ${next.model}`);
	if (next.thinking !== sent.thinking) changes.push(`${changes.length ? "thinking" : "Thinking"} ${next.thinking}`);
	// Missed tokens are billed as input, or as cache writes on providers that write them.
	const rate = prices ? Math.max(0, Math.max(prices.input, prices.cacheWrite) - prices.cacheRead) : 0;
	const cost = tokens * rate / 1_000_000;
	const size = tokens < 1_000_000 ? `${Math.round(tokens / 1000)}k` : `${(tokens / 1_000_000).toFixed(1)}M`;
	return `${changes.join(", ")}: the next request will likely re-bill ${size} context tokens${cost >= 0.01 ? ` (~$${cost.toFixed(2)})` : ""}. `
		+ "Switch at session start or right after compaction to avoid it.";
}
