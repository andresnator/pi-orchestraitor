import { getAgentDir, getPackageDir, SettingsManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const COMMAND = "auto-compact";
const RESET = "default";
const TOKEN_PLACES: Record<string, number> = { "": 0, k: 3, m: 6 };
const USAGE = "Usage: /auto-compact <tokens|default> (e.g. 150k, 0.5m, 300000); no argument shows the current threshold.";

/** Configure Pi's own threshold, rather than starting a second compaction loop. */
export default function autoCompact(pi: ExtensionAPI) {
	pi.registerCommand(COMMAND, {
		description: "Show or persist the current model's auto-compaction threshold in tokens (k/m supported); default resets it",
		handler: async (args, ctx) => {
			const argument = args.trim().toLowerCase();
			let saved = false;
			try {
				const threshold = argument && argument !== RESET ? parseTokens(argument) : undefined;
				if (argument) await ctx.waitForIdle();
				const model = ctx.model;
				if (!model) throw new Error("Select a model before using /auto-compact.");
				if (!Number.isSafeInteger(model.contextWindow) || model.contextWindow <= 0) {
					throw new Error("The current model has no valid context window.");
				}
				const key = `${model.provider}/${model.id}`;
				const settings = SettingsManager.inMemory(pi.getSettings()).getCompactionSettings(model);
				if (!argument) {
					ctx.ui.notify(`Auto-compaction for ${key}: ${settings.enabled ? "enabled" : "disabled"}; threshold > ${model.contextWindow - settings.reserveTokens} tokens (context window ${model.contextWindow}).`, "info");
					return;
				}
				if (threshold !== undefined && (threshold >= model.contextWindow || threshold <= settings.keepRecentTokens)) {
					throw new Error(`Threshold must be greater than keepRecentTokens (${settings.keepRecentTokens}) and less than the model's context window (${model.contextWindow}).`);
				}
				// Pi 1.2.0 exposes no reserveTokens setter. Use its installed storage and lock protocol,
				// then the command-only reload API to refresh the live SettingsManager.
				const { FileSettingsStorage } = await import(pathToFileURL(join(getPackageDir(), "dist/core/settings-manager.js")).href);
				const storage = new FileSettingsStorage(ctx.cwd, getAgentDir());
				storage.withLock("project", (text: string | undefined) => {
					const project = object(text === undefined ? undefined : JSON.parse(text), "Project settings");
					const compaction = object(project.compaction, "Project compaction settings");
					const overrides = object(compaction.modelOverrides, "Project model overrides");
					if (compaction.enabled === false || object(overrides[key], "Project model override").reserveTokens !== undefined) {
						throw new Error(".pi/settings.json overrides auto-compaction for this model; adjust the project setting first. Personal settings were not changed.");
					}
					return undefined;
				});
				storage.withLock("global", (text: string | undefined) => {
					const personal = object(text === undefined ? undefined : JSON.parse(text), "Personal settings");
					const compaction = object(personal.compaction, "Personal compaction settings");
					const overrides = object(compaction.modelOverrides, "Personal model overrides");
					const current = object(overrides[key], "Personal model override");
					if (threshold === undefined) {
						if (current.reserveTokens === undefined) return undefined;
						delete current.reserveTokens;
						if (Object.keys(current).length) overrides[key] = current;
						else delete overrides[key];
					} else {
						compaction.enabled = true;
						overrides[key] = { ...current, reserveTokens: model.contextWindow - threshold };
					}
					personal.compaction = { ...compaction, modelOverrides: overrides };
					saved = true;
					return JSON.stringify(personal, null, 2) + "\n";
				});
				ctx.ui.notify(saved
					? `Saved auto-compaction for ${key}: ${threshold === undefined ? "inherited native threshold" : `> ${threshold} tokens`}. Reloading Pi to apply it; active readers and panels will close.`
					: `No personal threshold override for ${key}; native settings remain unchanged.`, "info");
			} catch (error) {
				ctx.ui.notify(`Auto-compaction configuration failed: ${error instanceof Error ? error.message : String(error)}`, "error");
				return;
			}
			// A reload invalidates ctx and pi; do not use either afterward, even on failure.
			if (saved) await ctx.reload();
		},
	});
}

function parseTokens(argument: string) {
	const match = /^(\d+)(?:\.(\d+))?([km])?$/.exec(argument);
	if (!match) throw new Error(USAGE);
	const places = TOKEN_PLACES[match[3] ?? ""];
	const fraction = match[2] ?? "";
	// Decimal shifts avoid rejecting exact token amounts because of floating-point rounding.
	if (/[^0]/.test(fraction.slice(places))) throw new Error("Threshold must resolve to a positive whole number of tokens.");
	const tokens = Number(match[1] + fraction.slice(0, places).padEnd(places, "0"));
	if (!Number.isSafeInteger(tokens) || tokens <= 0) throw new Error("Threshold must resolve to a positive safe integer of tokens.");
	return tokens;
}

function object(value: unknown, label: string): Record<string, unknown> {
	if (value === undefined) return {};
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object; configuration was not changed.`);
	return value as Record<string, unknown>;
}
