import {
	createBashToolDefinition,
	createEditToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	keyHint,
	type ExtensionAPI,
	type Theme,
	type ThemeBg,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import type { TSchema } from "typebox";

const HORIZONTAL_PADDING = 1;
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
		pi.registerTool(compactTool(createReadToolDefinition(ctx.cwd, {
			autoResizeImages: settings.images?.autoResize,
		})));
		pi.registerTool(compactTool(createBashToolDefinition(ctx.cwd, {
			commandPrefix: settings.shellCommandPrefix,
			shellPath: settings.shellPath,
		})));
		pi.registerTool(compactTool(createEditToolDefinition(ctx.cwd)));
		pi.registerTool(compactTool(createWriteToolDefinition(ctx.cwd)));
	});
}

function compactTool<TParams extends TSchema, TDetails, TState>(
	original: ToolDefinition<TParams, TDetails, TState>,
): ToolDefinition<TParams, TDetails, TState> {
	return {
		...original,
		// Do not activate tools disabled by CLI options or user preferences.
		defaultActive: false,
		renderShell: "self",
		renderCall(args, theme, context) {
			return renderCall(original.name, args, theme, context);
		},
		renderResult(result, { expanded }, theme, context) {
			if (!expanded) return EMPTY_COMPONENT;

			const output = result.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("\n");
			const diff = original.name === "edit" && result.details &&
				typeof result.details === "object" && "diff" in result.details
				? result.details.diff : undefined;
			const details = typeof diff === "string" ? `${output}\n${diff}` : output;
			if (!details) return EMPTY_COMPONENT;

			return withBackground(new Text(theme.fg("toolOutput", details), 0, 0), theme, context);
		},
	};
}

function renderCall(name: string, args: unknown, theme: Theme, context: RenderContext): Component {
	const marker = context.expanded ? EXPANDED_MARKER : COLLAPSED_MARKER;
	const status = context.isError
		? STATUS.error
		: !context.isPartial
			? STATUS.done
			: context.executionStarted
				? STATUS.running
				: STATUS.preparing;
	const statusColor = context.isError ? "error" : context.isPartial ? "muted" : "success";
	const summary = summarizeArgs(args);
	const header = `${marker} ${theme.fg("toolTitle", theme.bold(name))} · ${theme.fg(statusColor, status)}`;

	if (context.expanded) {
		const argumentsText = JSON.stringify(args, null, 2) ?? "";
		return withBackground(
			new Text(`${header}\n${theme.fg("toolOutput", argumentsText)}`, 0, 0),
			theme,
			context,
		);
	}

	const hint = keyHint("app.tools.expand", "detalles");
	const label = `${header}${summary ? ` · ${theme.fg("accent", summary)}` : ""} ${hint}`;
	return withBackground(
		{ render: (width) => [truncateToWidth(label, width)], invalidate() {} },
		theme,
		context,
	);
}

function summarizeArgs(args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const command = "command" in args ? args.command : undefined;
	const subject = typeof command === "string" ? command : "path" in args ? args.path : undefined;
	return typeof subject === "string" ? subject.replace(/\s+/gu, " ").trim() : "";
}

function withBackground(component: Component, theme: Theme, context: RenderContext): Component {
	const background: ThemeBg = context.isError
		? "toolErrorBg"
		: context.isPartial
			? "toolPendingBg"
			: "toolSuccessBg";

	return {
		invalidate: () => component.invalidate(),
		render(width) {
			const padding = Math.min(HORIZONTAL_PADDING, Math.floor(Math.max(0, width - 1) / 2));
			const contentWidth = Math.max(1, width - padding * 2);
			return component.render(contentWidth).map((line) => {
				const padded = truncateToWidth(`${" ".repeat(padding)}${line}`, width);
				return theme.bg(background, padded + " ".repeat(Math.max(0, width - visibleWidth(padded))));
			});
		},
	};
}
