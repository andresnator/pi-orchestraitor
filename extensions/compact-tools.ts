import { sanitizeDisplay } from "./ui/display.ts";
import { classifyAgent } from "./ui/agents.ts";
import {
	createCodemodeExtension,
	keyHint,
	type ExtensionAPI,
	type Theme,
	type ToolDefinition,
	type ToolRenderers,
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
const NATIVE_TOOLS = new Set(["read", "bash", "edit", "write", "codemode"]);

type RenderContext = Parameters<NonNullable<ToolDefinition["renderCall"]>>[2];

/** Compact presentation only; Pi or the owning extension keeps execution, settings and model-facing results. */
export default function compactTools(pi: ExtensionAPI) {
	// Pi's codemode factory registers synchronously; its schema identifies the native tool.
	let codemodeSchema: unknown;
	createCodemodeExtension()({ registerTool(tool: ToolDefinition) { codemodeSchema = tool.parameters; } } as unknown as ExtensionAPI);
	// Interactive mode always supplies built-in renderers to `next()`, so filling gaps is not enough.
	// Compact Pi's own tools (or unregistered history calls) and leave foreign owners' renderers alone.
	pi.registerToolRenderer((name, next) => {
		if (!NATIVE_TOOLS.has(name)) return next();
		const tool = pi.getAllTools().find((candidate) => candidate.name === name);
		if (tool && (name === "codemode" ? tool.parameters !== codemodeSchema : tool.sourceInfo.source !== "builtin")) return next();
		const { renderShell, renderCall, renderResult } = compactTool({ ...next(), name } as ToolDefinition);
		return { renderShell, renderCall, renderResult } satisfies ToolRenderers;
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
			if (context.expanded && !context.isError && original.name === "codemode" && original.renderCall) {
				return original.renderCall(args, theme, { ...context, lastComponent: undefined });
			}
			// Pi builds the call component before the result component. Read the
			// summary at render time so streaming updates appear in the same row.
			return {
				render: (width) => renderCall(original.name, args, theme, context,
					context.isError ? undefined : summaries.get(context.state as object)).render(width),
				invalidate() {},
			};
		},
		renderResult(result, options, theme, context) {
			const { expanded } = options;
			const summary = summarizeResult(original.name, context.isError ? undefined : result.details);
			summaries.set(context.state as object, summary);
			if (expanded && !context.isError && original.name === "codemode" && original.renderResult) {
				return original.renderResult(result, options, theme, { ...context, lastComponent: undefined });
			}
			if (!expanded && !context.isError && !summary.failed) return EMPTY_COMPONENT;

			let output = result.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("\n");
			if (expanded && !context.isError && result.details && typeof result.details === "object") {
				if (["subagent_run", "subagent_collect"].includes(original.name) && "results" in result.details && Array.isArray(result.details.results)) {
					output = JSON.stringify("pending" in result.details && Array.isArray(result.details.pending) && result.details.pending.length ? { results: result.details.results, pending: result.details.pending } : result.details.results, null, 2);
				} else if (original.name === "orchestraitor_tasks" && "state" in result.details) {
					output = JSON.stringify(result.details, null, 2);
				}
			}
			const diff = !context.isError && original.name === "edit" && result.details &&
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
	if (["subagent_run", "subagent_collect"].includes(name) && "results" in details && Array.isArray(details.results)) {
		const results = details.results;
		const failures = results.filter((task) => classifyAgent(task).failed || classifyAgent(task).phase === "unavailable");
		const pending = "pending" in details && Array.isArray(details.pending) ? details.pending.length : 0;
		return { text: `${results.length - failures.length}/${results.length} completed${pending ? ` · ${pending} pending collection` : ""}`, failed: failures.length > 0,
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
