import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const isBash = (name) => typeof name === "string" && name.trim().toLowerCase() === "bash";

async function readConfig(path, validateTools = true) {
	const text = await readFile(path, "utf8").catch((error) => {
		if (error.code !== "ENOENT") throw error;
	});
	const config = JSON.parse(text ?? "{}");
	if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error(`${path}: expected a JSON object.`);
	if (validateTools && Object.hasOwn(config, "disableTools") && !Array.isArray(config.disableTools)) {
		throw new Error(`${path}: disableTools must be an array before installing.`);
	}
	return { text, config };
}

/** Own only the added bash exclusion; retain other Pretty edits on rollback. */
export async function planPrettyConfig(env = process.env) {
	const disabled = (env.PRETTY_DISABLE_TOOLS ?? "").split(",").map((name) => name.trim().toLowerCase()).filter(Boolean);
	if (disabled.length && !disabled.includes("bash")) {
		throw new Error("PRETTY_DISABLE_TOOLS overrides pi-pretty.json and omits bash. Add bash to that comma-separated list or unset PRETTY_DISABLE_TOOLS, then rerun install:pi. No files were changed.");
	}
	if (env.PRETTY_CONFIG_DIR === "") throw new Error("PRETTY_CONFIG_DIR is empty; set a directory or unset it before installing.");
	// Pretty's default follows HOME, independently of PI_CODING_AGENT_DIR.
	const path = resolve(join(env.PRETTY_CONFIG_DIR ?? join(env.HOME ?? homedir(), ".pi", "agent"), "pi-pretty.json"));
	const initial = await readConfig(path);
	let applied;
	return {
		preview: { path, disableTools: initial.config.disableTools?.some(isBash)
			? initial.config.disableTools : [...(initial.config.disableTools ?? []), "bash"],
			changed: !initial.config.disableTools?.some(isBash) },
		async apply() {
			// Re-read under the install transaction, retaining edits since preview.
			const before = await readConfig(path);
			if (before.config.disableTools?.some(isBash)) return;
			const after = { ...before.config, disableTools: [...(before.config.disableTools ?? []), "bash"] };
			const text = `${JSON.stringify(after, null, 2)}\n`;
			await mkdir(dirname(path), { recursive: true });
			applied = { before, text };
			await writeFile(path, text);
		},
		async rollback() {
			if (!applied) return;
			const current = await readConfig(path, false);
			if (current.text === undefined) return;
			const before = applied.before;
			if (current.text !== applied.text) {
				const index = Array.isArray(current.config.disableTools) ? current.config.disableTools.indexOf("bash") : -1;
				if (index < 0) return;
				current.config.disableTools.splice(index, 1);
				if (!current.config.disableTools.length && !Object.hasOwn(before.config, "disableTools")) delete current.config.disableTools;
				if (JSON.stringify(current.config) !== JSON.stringify(before.config)) {
					await writeFile(path, `${JSON.stringify(current.config, null, 2)}\n`);
					return;
				}
			}
			if (before.text === undefined) await rm(path);
			else await writeFile(path, before.text);
		},
	};
}
