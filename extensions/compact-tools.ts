import { sanitizeDisplay } from "./ui/display.ts";
import { classifyAgent } from "./ui/agents.ts";
import {
	createBashToolDefinition,
	createCodemodeExtension,
	createEditToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	keyHint,
	type ExtensionAPI,
	type Theme,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import type { TSchema } from "typebox";

const HORIZONTAL_PADDING = 1;
const ERROR_ROWS = 3;
const COLLAPSED_MARKER = "▸";
const EXPANDED_MARKER = "▾";
const STATUS = {
	preparing: "preparing…",
	running: "running…",
	done: "completed",
	error: "error",
} as const;
const EMPTY_COMPONENT: Component = { render: () => [], invalidate() {} };

type RenderContext = Parameters<NonNullable<ToolDefinition["renderCall"]>>[2];

/** Compact presentation only; execution and model-facing results remain native. */
export default function compactTools(pi: ExtensionAPI) {
	// Wait for the effective settings and trusted working directory to be available.
	pi.on("session_start", (_event, ctx) => {
		const settings = pi.getSettings();
		const registerInactive = (tool: ToolDefinition) => pi.registerTool({ ...compactTool(tool), defaultActive: false });
		registerInactive(createReadToolDefinition(ctx.cwd, {
			autoResizeImages: settings.images?.autoResize,
		}));
		registerInactive(createBashToolDefinition(ctx.cwd, {
			commandPrefix: settings.shellCommandPrefix,
			shellPath: settings.shellPath,
		}));
		registerInactive(createEditToolDefinition(ctx.cwd));
		registerInactive(createWriteToolDefinition(ctx.cwd));

		// Reuse Pi's public factory only when its native codemode is already present.
		// Delayed registration keeps disabled built-ins absent and avoids a startup
		// replacement warning. Schema identity leaves foreign codemode tools alone.
		const codemode = pi.getAllTools().find((tool) => tool.name === "codemode");
		if (codemode) createCodemodeExtension()({
			...pi,
			registerTool(tool) {
				if (tool.parameters === codemode.parameters) pi.registerTool(compactTool(tool));
			},
		});
	});
}

type Summary = { text: string; failed: boolean; errors: string };

/** Shared presentation for native tools and the package's bounded subagents. */
export function compactTool<TParams extends TSchema, TDetails, TState>(
	original: ToolDefinition<TParams, TDetails, TState>,
): ToolDefinition<TParams, TDetails, TState> {
	const summaries = new WeakMap<object, Summary>();
	return {
		...original,
		renderShell: "self",
		renderCall(args, theme, context) {
			if (context.expanded && original.name === "codemode" && original.renderCall) {
				return original.renderCall(args, theme, { ...context, lastComponent: undefined });
			}
			// Pi builds the call component before the result component. Read the
			// summary at render time so streaming updates appear in the same row.
			return {
				render: (width) => renderCall(original.name, args, theme, context,
					summaries.get(context.state as object)).render(width),
				invalidate() {},
			};
		},
		renderResult(result, options, theme, context) {
			const { expanded } = options;
			const summary = summarizeResult(original.name, result.details);
			summaries.set(context.state as object, summary);
			if (expanded && original.name === "codemode" && original.renderResult) {
				return original.renderResult(result, options, theme, { ...context, lastComponent: undefined });
			}
			if (!expanded && !context.isError && !summary.failed) return EMPTY_COMPONENT;

			const output = result.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("\n");
			const diff = original.name === "edit" && result.details &&
				typeof result.details === "object" && "diff" in result.details
				? result.details.diff : undefined;
			const errorOffset = output.lastIndexOf("\nScript error:");
			const scriptError = original.name === "codemode" && context.isError && errorOffset >= 0
				? output.slice(errorOffset + "\nScript error:".length).trimStart() : undefined;
			const details = sanitizeDisplay(!expanded && scriptError
				? scriptError : !expanded && !context.isError && summary.failed
					? summary.errors : typeof diff === "string" ? `${output}\n${diff}` : output);
			if (!details) return EMPTY_COMPONENT;

			const text = new Text(theme.fg("toolOutput", expanded ? details : details.trimEnd()), 0, 0);
			return withBackground(expanded ? text : {
				render: (width) => original.name === "codemode"
					? text.render(width).slice(0, ERROR_ROWS) : text.render(width).slice(-ERROR_ROWS),
				invalidate: () => text.invalidate(),
			}, theme, { ...context, isError: context.isError || summary.failed });
		},
	};
}

function renderCall(name: string, args: unknown, theme: Theme, context: RenderContext, result?: Summary): Component {
	const marker = context.expanded ? EXPANDED_MARKER : COLLAPSED_MARKER;
	const failed = context.isError || result?.failed;
	const status = context.isError
		? STATUS.error
		: result?.failed
			? context.isPartial ? "running with errors…" : "completed with errors"
		: !context.isPartial
			? STATUS.done
			: context.executionStarted
				? STATUS.running
				: STATUS.preparing;
	const statusColor = failed ? "error" : context.isPartial ? "muted" : "success";
	const summary = [summarizeArgs(name, args), result?.text].filter(Boolean).join(" · ");
	const header = `${marker} ${theme.fg("toolTitle", theme.bold(name))} · ${theme.fg(statusColor, status)}`;

	if (context.expanded) {
		const argumentsText = sanitizeDisplay(JSON.stringify(args, null, 2) ?? "");
		return withBackground(
			new Text(`${header}\n${theme.fg("toolOutput", argumentsText)}`, 0, 0),
			theme,
			context,
		);
	}

	const hint = keyHint("app.tools.expand", "details");
	const label = `${header}${summary ? ` · ${theme.fg("accent", summary)}` : ""} ${hint}`;
	return withBackground(
		{ render: (width) => [truncateToWidth(label, width)], invalidate() {} },
		theme,
		{ ...context, isError: Boolean(failed) },
	);
}

function summarizeArgs(name: string, args: unknown): string {
	if (!args || typeof args !== "object") return "";
	if (name === "subagent_run" && "tasks" in args && Array.isArray(args.tasks)) {
		const roles = args.tasks.map((task) => task?.role).filter((role) => typeof role === "string");
		return `${args.tasks.length} task${args.tasks.length === 1 ? "" : "s"} · ${sanitizeDisplay(roles.join(", "))}`;
	}
	const command = "command" in args ? args.command : undefined;
	const subject = typeof command === "string" ? command : "path" in args ? args.path : undefined;
	return typeof subject === "string" ? sanitizeDisplay(subject).replace(/\s+/gu, " ").trim() : "";
}

function summarizeResult(name: string, details: unknown): Summary {
	const empty = { text: "", failed: false, errors: "" };
	if (!details || typeof details !== "object") return empty;
	if (name === "codemode" && "calls" in details && Array.isArray(details.calls)) {
		const calls = details.calls;
		const running = calls.filter((call) => call.status === "running");
		const completed = calls.filter((call) => call.status === "ok").length;
		const failures = calls.filter((call) => call.status === "error" || call.status === "cancelled");
		const text = calls.length ? [
			`${calls.length} call${calls.length === 1 ? "" : "s"}`,
			running.length ? `${running.length} running (${sanitizeDisplay(String(running.at(-1).name))})` : `${completed} completed`,
			failures.length ? `${failures.length} failed` : "",
		].filter(Boolean).join(" · ") : "script";
		return { text, failed: failures.length > 0,
			errors: failures.map((call) => `${call.name}: ${call.error || call.status}`).join("\n") };
	}
	if (name === "subagent_run" && "progress" in details && details.progress &&
		typeof details.progress === "object" && "tasks" in details.progress && Array.isArray(details.progress.tasks)) {
		const tasks = details.progress.tasks;
		const states = tasks.map(classifyAgent);
		const failures = tasks.filter((_task, index) => states[index].failed);
		const active = states.filter((state) => state.active).length;
		const completed = states.filter((state) => state.phase === "completed").length;
		return { text: `${active} active · ${completed}/${tasks.length} completed`, failed: failures.length > 0,
			errors: failures.map((task) => `${task.role}: ${classifyAgent(task).phase}${task.diagnostic ? ` · ${task.diagnostic}` : ""}`).join("\n") };
	}
	if (name === "subagent_run" && "results" in details && Array.isArray(details.results)) {
		const results = details.results;
		const failures = results.filter((task) => classifyAgent(task).failed || classifyAgent(task).phase === "unavailable");
		return { text: `${results.length - failures.length}/${results.length} completed`, failed: failures.length > 0,
			errors: failures.map((task) => `${task.role}: ${task.status}${task.diagnostic ? ` · ${task.diagnostic}` : ""}`).join("\n") };
	}
	return empty;
}

function withBackground(component: Component, theme: Theme, context: RenderContext): Component {
	return {
		invalidate: () => component.invalidate(),
		render(width) {
			const padding = Math.min(HORIZONTAL_PADDING, Math.floor(Math.max(0, width - 1) / 2));
			const contentWidth = Math.max(1, width - padding * 2);
			return component.render(contentWidth).map((line) => {
				const padded = truncateToWidth(`${" ".repeat(padding)}${line}`, width);
				return context.isError
					? theme.bg("toolErrorBg", padded + " ".repeat(Math.max(0, width - visibleWidth(padded))))
					: padded;
			});
		},
	};
}
