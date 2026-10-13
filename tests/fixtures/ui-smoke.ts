/** Test-only native UI driver. Never load with personal configuration or ship in a package. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { replayTasks } from "../../extensions/ui/tasks.ts";

const MODEL = "ui-smoke/model";
const ACTIONS = ["tasks-create", "tasks-start", "tasks-block", "tasks-done", "tasks-reopen", "single", "form"];
const MARKER = "marker: SYNTHETIC-UI-47\nunknown: 7319\nnote: synthetic only\n";
const INITIAL_TYPO = "synthetic tpyo\n";
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
const MODEL_DEFINITION = { id: "model", name: "Synthetic UI fixture (not a live model)", reasoning: false, input: ["text"] as const,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 2048 };
const PROFILE_KEY = Symbol.for("pi-orchestraitor.ui-smoke-owned-profile");
type ProfileOwner = { root: string; digest: string };
const shared = globalThis as typeof globalThis & { [key: symbol]: ProfileOwner | undefined };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const messageText = (message: any) => typeof message?.content === "string" ? message.content : (message?.content ?? []).map((block: any) => block.text ?? "").join("\n");

export default function smoke(pi: ExtensionAPI) {
	if (process.env.UI_SMOKE_ENABLED !== "1" || !process.env.UI_SMOKE_ROOT) throw new Error("UI smoke fixture requires explicit UI_SMOKE_ENABLED=1 and a fresh isolated UI_SMOKE_ROOT");
	const root = process.env.UI_SMOKE_ROOT;
	let branch: () => any[] = () => [];

	pi.registerProvider("ui-smoke", {
		api: "openai-completions", baseUrl: "https://example.invalid", apiKey: "fixture", models: [MODEL_DEFINITION],
		streamSimple(model, context, options) {
			const stream = createAssistantMessageEventStream();
			void (async () => {
				const user = context.messages.filter((message) => message.role === "user").at(-1);
				const action = messageText(user).replace(/^ui-smoke:/u, "").trim();
				const first = context.messages.at(-1)?.role === "user";
				const call = first && ACTIONS.includes(action) ? operation(action, replayTasks(branch())) : undefined;
				const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
					stopReason: options?.signal?.aborted ? "aborted" : call ? "toolUse" : "stop",
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { ...ZERO_COST } },
					content: call ? [{ type: "toolCall", id: randomUUID(), ...call }] : [{ type: "text", text: `Synthetic fixture finished: ${action}. Inspect native receipts; this is not live-model evidence.` }],
					...(options?.signal?.aborted ? { errorMessage: "Synthetic parent request aborted" } : {}),
				};
				await options?.onPayload?.({ fixture: true, action }, model);
				stream.push({ type: "start", partial: message });
				if (call) {
					const toolCall = message.content[0] as any;
					stream.push({ type: "toolcall_start", contentIndex: 0, partial: message });
					stream.push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(toolCall.arguments), partial: message });
					stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message });
				} else {
					stream.push({ type: "text_start", contentIndex: 0, partial: message });
					stream.push({ type: "text_delta", contentIndex: 0, delta: (message.content[0] as any).text, partial: message });
					stream.push({ type: "text_end", contentIndex: 0, content: (message.content[0] as any).text, partial: message });
				}
				if (message.stopReason === "aborted") stream.push({ type: "error", reason: "aborted", error: message });
				else stream.push({ type: "done", reason: call ? "toolUse" : "stop", message });
				stream.end(message);
			})().catch((error) => {
				const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: "error", errorMessage: String(error), content: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { ...ZERO_COST } } } as AssistantMessage;
				stream.push({ type: "error", reason: "error", error: message }); stream.end(message);
			});
			return stream;
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (await realpath(ctx.cwd) !== join(root, "workspace") || await realpath(getAgentDir()) !== join(root, "profile")) throw new Error("UI smoke fixture refuses non-isolated workspace/profile");
		branch = () => ctx.sessionManager.getBranch();
		for (const [name, content] of [["marker.txt", MARKER], ["typo.txt", INITIAL_TYPO], ["plan.md", "# Synthetic UI plan\n\nGroup 1: inspect\nGroup 2: verify\n"]]) {
			try { await writeFile(join(ctx.cwd, name), content, { flag: "wx" }); }
			catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
		}
		await mkdir(join(ctx.cwd, ".git"), { recursive: true });
		if (ctx.mode === "tui") {
			ctx.ui.setWidget("ui-smoke:foreign-widget", ["Foreign fixture widget"], { placement: "belowEditor" });
			ctx.ui.setStatus("ui-smoke:foreign-status", "Foreign fixture status");
		}
	});
	pi.on("session_shutdown", async (_event, ctx) => {
		if (ctx.mode === "tui") { ctx.ui.setWidget("ui-smoke:foreign-widget", undefined); ctx.ui.setStatus("ui-smoke:foreign-status", undefined); }
	});
	pi.registerCommand("ui-smoke", {
		description: "Test-only synthetic driver; all feature tools run through native model calls",
		handler(args, ctx) {
			const action = args.trim();
			if (!ACTIONS.includes(action)) { ctx.ui.notify(`Use /ui-smoke ${ACTIONS.join("|")}`, "warning"); return; }
			pi.sendUserMessage(`ui-smoke:${action}`);
		},
	});
}

function operation(action: string, state: ReturnType<typeof replayTasks>) {
	if (action.startsWith("tasks-")) {
		const status = ({ "tasks-start": "in_progress", "tasks-block": "blocked", "tasks-done": "done", "tasks-reopen": "pending" } as const)[action as "tasks-start"];
		const arguments_ = action === "tasks-create"
			? { operation: "replace", expectedRevision: state.revision, tasks: [{ id: "inspect", title: "Inspect marker 原é", status: "pending" }, { id: "verify", title: "Verify native receipts", status: "pending" }] }
			: { operation: "update", expectedRevision: state.revision, id: "inspect", changes: { status, ...(status === "done" ? { evidence: "Synthetic parent inspected native marker read receipt" } : {}), ...(action === "tasks-reopen" ? { reason: "Synthetic correction before acceptance" } : {}) } };
		return { name: "orchestraitor_tasks", arguments: arguments_ };
	}
	if (action === "single" || action === "form") {
		const options = [{ label: "Alpha 原", value: "opaque/alpha" }, { label: "Beta é", value: "opaque/beta" }];
		return { name: "orchestraitor_ask", arguments: { questions: action === "single" ? [{ id: "single/id", prompt: "Synthetic choice: choose a harmless marker", selection: "single", options }]
			: [{ id: "multi/id", prompt: "Select explicit markers; then continue", selection: "multiple", options }, { id: "text/id", prompt: "Choose a marker or write synthetic text", selection: "single", allowText: true, options }] } };
	}
	return undefined;
}
