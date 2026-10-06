import * as sdk from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { compactTool } from "./compact-tools.ts";
import { createSkillRegistry, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT, REGISTRY_RESOLVE_EVENT } from "./skills/registry.mjs";
import type { SkillResolutionRequest } from "./skills/types.ts";

const TOOL = "skill_registry";
const FLAG = "orchestraitor-skills";
const SECTION = "pi_orchestraitor_skills";
const GUIDANCE = "Skills are indexed in .ai/skills/registry.md without publishing their headers. Use skill_registry search with relevant English task/domain terms, then load only selected names. The registry file is a diagnostic snapshot, not availability authority. New sources/names require native Pi configuration and /reload. Resolve relative resources from the loaded skill directory; pass selected names to subagent_run. If the tool is disabled, use the native catalog.";

/** Lazy exposure of the native catalog; never discovers or enables foreign paths. */
export default function skillRegistry(pi: ExtensionAPI) {
	const registry = createSkillRegistry(sdk);
	let mode = "native";
	let unsubscribe: (() => void) | undefined;
	pi.registerFlag(FLAG, { type: "string", default: "lazy", description: "Skill exposure: lazy or native" });
	pi.on("session_start", async (_event, ctx) => {
		const requested = pi.getFlag(FLAG);
		if (requested !== "lazy" && requested !== "native") throw new Error("--orchestraitor-skills must be lazy or native");
		mode = requested;
		unsubscribe?.();
		unsubscribe = pi.events.on(REGISTRY_RESOLVE_EVENT, (request: SkillResolutionRequest) => {
			if (mode === "lazy") request.result = registry.resolveNames(request.names, request.context);
		});
		if (mode === "lazy") await registry.start(ctx);
		else registry.dispose();
	});
	pi.on("before_agent_start", async (event, ctx) => {
		delete event.systemPromptOptions.sections[SECTION];
		if (mode === "native") {
			event.systemPromptOptions.selectedTools = event.systemPromptOptions.selectedTools.filter((name) => name !== TOOL);
			return;
		}
		await registry.capture(event.systemPromptOptions.skills, ctx);
		if (!event.systemPromptOptions.selectedTools.includes(TOOL)) return;
		// Mask cloned advertisements only. The host catalog and manual commands remain intact.
		event.systemPromptOptions.skills = event.systemPromptOptions.skills.map((skill) => ({ ...skill, disableModelInvocation: true }));
		event.systemPromptOptions.sections[SECTION] = GUIDANCE;
	});
	for (const event of ["session_before_switch", "session_before_fork", "session_before_tree"] as const) {
		pi.on(event, () => registry.dispose());
	}
	pi.on("session_shutdown", () => { registry.dispose(); unsubscribe?.(); unsubscribe = undefined; });
	pi.registerTool(compactTool({
		name: TOOL, label: "Skill registry",
		description: "Search the native-authorized skill index or load one selected skill. New sources/names require Pi configuration and /reload; manual-only skills use explicit /skill commands.",
		parameters: Type.Object({
			operation: Type.Union([Type.Literal("search"), Type.Literal("load")]),
			query: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
			name: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_SEARCH_LIMIT })),
		}),
		async execute(_id, args, signal, _update, ctx) {
			if (mode !== "lazy") throw new Error("Skill registry is in native mode; use /orchestraitor:skills lazy");
			const context = { ...ctx, signal };
			if (args.operation === "search") {
				const result = await registry.search(args.query, args.limit ?? DEFAULT_SEARCH_LIMIT, context);
				const persistence = registry.status().persistence;
				const content = { ...result, ...(persistence?.error ? { persistenceError: persistence.error } : {}) };
				return { content: [{ type: "text", text: JSON.stringify(content) }], details: result };
			}
			if (!args.name) throw new Error("Skill load requires a name");
			const [{ skill, body }] = await registry.resolveNames([args.name], context);
			return { content: [{ type: "text", text: `Skill ${skill.name}: ${skill.filePath}\nResolve relative resources from ${skill.baseDir}.\n\n${body}` }],
				details: { name: skill.name, filePath: skill.filePath, persistence: registry.status().persistence } };
		},
	}));
	pi.registerCommand("orchestraitor:skills", {
		description: "Skill registry: status, refresh, lazy or native",
		async handler(args, ctx) {
			const operation = args.trim() || "status";
			if (!["status", "refresh", "lazy", "native"].includes(operation)) throw new Error("Use /orchestraitor:skills status|refresh|lazy|native");
			if (operation === "native") {
				mode = "native";
				registry.dispose();
				pi.setActiveTools(pi.getActiveTools().filter((name) => name !== TOOL));
			} else if (operation === "lazy" || operation === "refresh") {
				if (operation === "lazy") {
					mode = "lazy";
					pi.setActiveTools([...new Set([...pi.getActiveTools(), TOOL])]);
				}
				if (mode !== "lazy") throw new Error("Use /orchestraitor:skills lazy before refreshing");
				await registry.capture(ctx.getSystemPromptOptions().skills ?? [], ctx);
			}
			ctx.ui.notify(JSON.stringify({ mode, ...registry.status() }), "info");
		},
	});
}
