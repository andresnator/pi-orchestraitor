import { SettingsManager, type ContextUsage, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { renderFooter, type TokenTotals } from "./ui/footer.ts";

type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number; cost: { total: number } };
type UsageEntry = { type: string; usage?: Usage; message?: { role: string; usage?: Usage } };
type SessionTotals = { key: string; tokens: TokenTotals; cacheHitRate?: number; autoCompact: boolean; contextUsage: ContextUsage | undefined };

/** Replace Pi's terminal footer with a project line and a metrics line that names the provider and model. */
export default function footer(pi: ExtensionAPI) {
	// Pi restores its own footer whenever it resets extension UI, so every session installs this one again.
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		let totals: SessionTotals | undefined;
		ctx.ui.setFooter((tui, theme, data) => ({
			dispose: data.onBranchChange(() => tui.requestRender()),
			invalidate() {},
			render(width: number) {
				// A replaced session's context throws until Pi installs the next session's footer.
				try {
					totals = sessionTotals(pi, ctx, totals);
					const model = ctx.model;
					const usage = totals.contextUsage;
					return renderFooter({
						cwd: displayCwd(ctx.cwd), branch: data.getGitBranch(), sessionName: ctx.sessionManager.getSessionName(),
						tokens: totals.tokens, cacheHitRate: totals.cacheHitRate,
						context: { percent: usage ? usage.percent : 0, window: usage?.contextWindow ?? model?.contextWindow ?? 0, autoCompact: totals.autoCompact },
						model: model && { provider: model.provider, name: model.name || model.id, reasoning: !!model.reasoning },
						thinkingLevel: ctx.thinkingLevel ?? "off",
						statuses: data.getExtensionStatuses(),
					}, width, theme);
				} catch {
					return [];
				}
			},
		}));
	});
}

/** Native footer totals: all session usage, the cache hit rate of the latest response and context usage, which also scans the session. */
function sessionTotals(pi: ExtensionAPI, ctx: ExtensionContext, previous: SessionTotals | undefined): SessionTotals {
	const manager = ctx.sessionManager;
	const model = ctx.model;
	// Entries only append and every append moves the leaf, so totals change only with the leaf, session or model.
	const key = [manager.getSessionId(), manager.getLeafId(), model?.provider, model?.id].join("\0");
	if (previous?.key === key) return previous;
	const tokens: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	let cacheHitRate: number | undefined;
	for (const entry of manager.getEntries() as readonly UsageEntry[]) {
		const usage = entryUsage(entry);
		if (!usage) continue;
		tokens.input += usage.input;
		tokens.output += usage.output;
		tokens.cacheRead += usage.cacheRead;
		tokens.cacheWrite += usage.cacheWrite;
		tokens.cost += usage.cost.total;
		if (entry.message?.role !== "assistant") continue;
		const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
		cacheHitRate = prompt > 0 ? usage.cacheRead / prompt * 100 : undefined;
	}
	const autoCompact = SettingsManager.inMemory(pi.getSettings()).getCompactionSettings(model).enabled;
	return { key, tokens, cacheHitRate, autoCompact, contextUsage: ctx.getContextUsage() };
}

function entryUsage(entry: UsageEntry): Usage | undefined {
	if (entry.type === "usage" || entry.type === "branch_summary" || entry.type === "compaction") return entry.usage;
	if (entry.type === "message" && (entry.message?.role === "assistant" || entry.message?.role === "toolResult")) return entry.message.usage;
	return undefined;
}

function displayCwd(cwd: string): string {
	const fromHome = relative(resolve(homedir()), resolve(cwd));
	if (fromHome === "") return "~";
	return fromHome !== ".." && !fromHome.startsWith(`..${sep}`) && !isAbsolute(fromHome) ? `~${sep}${fromHome}` : cwd;
}
