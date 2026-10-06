import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const isBash = (name) => typeof name === "string" && name.trim().toLowerCase() === "bash";

async function writeConfig(path, text) {
	const temporary = `${path}.${randomUUID()}.tmp`;
	const mode = await stat(path).then((info) => info.mode & 0o777).catch((error) => {
		if (error.code !== "ENOENT") throw error;
		return 0o600;
	});
	let staged = false;
	try {
		await writeFile(temporary, text, { flag: "wx", mode });
		staged = true;
		await rename(temporary, path);
	} catch (error) {
		// A rejected write may still have created a partial file. Never remove
		// a pre-existing temporary that caused exclusive creation to fail.
		if (staged || error.code !== "EEXIST") {
			try { await rm(temporary, { force: true }); }
			catch (cleanup) { throw new AggregateError([error, cleanup], `${error.message}; temporary cleanup failed: ${cleanup.message}`); }
		}
		throw error;
	}
}

async function readConfig(path, validateTools = true) {
	const info = await lstat(path).catch((error) => {
		if (error.code !== "ENOENT") throw error;
	});
	// Resolve file links before publication so rename updates the managed
	// target, preserving relative links and link chains. Reject dangling links.
	const destination = info?.isSymbolicLink() ? await realpath(path).catch((error) => {
		throw new Error(`${path}: configuration link target cannot be resolved: ${error.message}`, { cause: error });
	}) : path;
	const text = await readFile(destination, "utf8").catch((error) => {
		if (error.code !== "ENOENT") throw error;
	});
	const config = JSON.parse(text ?? "{}");
	if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error(`${path}: expected a JSON object.`);
	if (validateTools && Object.hasOwn(config, "disableTools") && !Array.isArray(config.disableTools)) {
		throw new Error(`${path}: disableTools must be an array before installing.`);
	}
	return { text, config, destination };
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
			await mkdir(dirname(before.destination), { recursive: true });
			await writeConfig(before.destination, text);
			applied = { before, text };
		},
		async rollback() {
			if (!applied) return;
			const before = applied.before;
			// Recover the file we published even if its alias now points elsewhere.
			const current = await readConfig(before.destination, false);
			if (current.destination !== before.destination) throw new Error(`${path}: configuration target changed since installation; cannot roll back through a new link.`);
			if (current.text === undefined) { applied = undefined; return; }
			if (current.text !== applied.text) {
				const index = Array.isArray(current.config.disableTools) ? current.config.disableTools.indexOf("bash") : -1;
				if (index < 0) { applied = undefined; return; }
				current.config.disableTools.splice(index, 1);
				if (!current.config.disableTools.length && !Object.hasOwn(before.config, "disableTools")) delete current.config.disableTools;
				if (JSON.stringify(current.config) !== JSON.stringify(before.config)) {
					await writeConfig(before.destination, `${JSON.stringify(current.config, null, 2)}\n`);
					applied = undefined;
					return;
				}
			}
			if (before.text === undefined) await rm(before.destination);
			else await writeConfig(before.destination, before.text);
			applied = undefined;
		},
	};
}
