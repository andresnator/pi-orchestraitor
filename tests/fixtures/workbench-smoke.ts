/** Unshipped synthetic workbench driver. Reuses production tool calls and existing isolated child fixture. */
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import smoke from "./ui-smoke.ts";
type NavigationState = { root: string; returnLeaf?: string; returnFile?: string };
const NAVIGATION = Symbol.for("pi-orchestraitor.workbench-smoke-navigation");
export default function workbenchSmoke(pi: ExtensionAPI) {
	if (process.env.WORKBENCH_SMOKE_ENABLED !== "1") throw new Error("Workbench fixture requires explicit synthetic opt-in");
	smoke(pi);
	let veto: "tree" | "switch" | "fork" | undefined;
	const shared = globalThis as typeof globalThis & { [key: symbol]: NavigationState | undefined };
	const state = shared[NAVIGATION] ??= { root: process.env.UI_SMOKE_ROOT! };
	if (state.root !== process.env.UI_SMOKE_ROOT) throw new Error("Synthetic navigation refuses another workspace");
	pi.on("session_before_tree", () => veto === "tree" ? { cancel: true } : undefined);
	pi.on("session_before_switch", () => veto === "switch" ? { cancel: true } : undefined);
	pi.on("session_before_fork", () => veto === "fork" ? { cancel: true } : undefined);
	pi.registerCommand("workbench-smoke", {
		description: "Synthetic only: task/reader/question scenarios and native tree[-veto|-return], fork[-veto], switch[-veto|-back], new",
		async handler(args, ctx) {
			const action = args.trim();
			if (["tree", "tree-veto", "tree-return", "fork", "fork-veto", "switch-veto", "switch-back", "new"].includes(action)) {
				await ctx.waitForIdle();
				const before = { session: ctx.sessionManager.getSessionId(), leaf: ctx.sessionManager.getLeafId(), branch: ctx.sessionManager.getBranch().map(entry => entry.id) };
				const target = ctx.sessionManager.getBranch().find(entry => entry.type === "message" && entry.message.role === "user")?.id;
				let result: { cancelled: boolean }, effective = ctx;
				const withSession = async (next: typeof ctx) => { effective = next; };
				try {
					if (action.endsWith("-veto")) veto = action.startsWith("tree") ? "tree" : action.startsWith("fork") ? "fork" : "switch";
					if (action === "new") result = await ctx.newSession({ withSession });
					else if (action === "switch-veto") result = await ctx.switchSession(join(process.env.UI_SMOKE_ROOT!, "missing-veto.jsonl"));
					else if (action === "switch-back") {
						if (!state.returnFile) throw new Error("Synthetic switch requires a prior fork");
						result = await ctx.switchSession(state.returnFile, { withSession });
					} else {
						if (!target && action !== "tree-return") throw new Error("Synthetic navigation requires a user entry");
						if (action.startsWith("fork")) { state.returnFile = ctx.sessionManager.getSessionFile(); result = await ctx.fork(target!, { position: "at", withSession }); }
						else {
							if (action === "tree") state.returnLeaf = before.leaf ?? undefined;
							if (action === "tree-return" && !state.returnLeaf) throw new Error("Synthetic tree return requires prior navigation");
							result = await ctx.navigateTree(action === "tree-return" ? state.returnLeaf! : target!, { summarize: false });
						}
					}
					await appendFile(join(process.env.UI_SMOKE_ROOT!, "native-navigation.jsonl"), JSON.stringify({ synthetic: true, action, before, cancelled: result.cancelled,
						after: { session: effective.sessionManager.getSessionId(), leaf: effective.sessionManager.getLeafId(), branch: effective.sessionManager.getBranch().map(entry => entry.id) } }) + "\n", { mode: 0o600 });
					ctx.ui.notify(`Synthetic native ${action}: ${result.cancelled ? "cancelled" : "completed"}`, "info");
				} finally { veto = undefined; }
				return;
			}
			if (!["tasks-create", "tasks-start", "tasks-block", "tasks-done", "tasks-reopen", "two", "failure", "single", "form", "cancel", "retry"].includes(action)) { ctx.ui.notify("Use a documented synthetic workbench scenario.", "warning"); return; }
			pi.sendUserMessage(`ui-smoke:${action}`);
		},
	});
}
