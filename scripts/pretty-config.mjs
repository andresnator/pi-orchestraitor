import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const isBash = (name) => typeof name === "string" && name.trim().toLowerCase() === "bash";
// Pi's built-in themes are not Shiki themes, so Pretty warns on every session
// and highlights with github-dark. Pin the matching Shiki theme instead.
const SHIKI_THEMES = new Map([["dark", "github-dark"], ["light", "github-light"]]);

/** Mirror Pretty: it reads only `$HOME/.pi/agent/settings.json` and ignores an unreadable file. */
async function piTheme(env) {
	if (!env.HOME) return;
	try { return JSON.parse(await readFile(join(env.HOME, ".pi", "agent", "settings.json"), "utf8")).theme; }
	catch { return; }
}

async function plannedAdditions(config, env) {
	return {
		bash: !config.disableTools?.some(isBash),
		theme: Object.hasOwn(config, "theme") ? undefined : SHIKI_THEMES.get(await piTheme(env)),
	};
}

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
	// Pretty reads an empty file as {}; other malformed JSON stops before a write could replace it.
	let config;
	try { config = JSON.parse(text?.trim() || "{}"); }
	catch (error) { throw new Error(`${path}: invalid JSON (${error.message}); fix or empty the file, then rerun install:pi.`, { cause: error }); }
	if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error(`${path}: expected a JSON object.`);
	if (validateTools && Object.hasOwn(config, "disableTools") && !Array.isArray(config.disableTools)) {
		throw new Error(`${path}: disableTools must be an array before installing.`);
	}
	return { text, config, destination };
}

/** Own only the added bash exclusion and pinned theme; retain other Pretty edits on rollback. */
export async function planPrettyConfig(env = process.env) {
	const disabled = (env.PRETTY_DISABLE_TOOLS ?? "").split(",").map((name) => name.trim().toLowerCase()).filter(Boolean);
	if (disabled.length && !disabled.includes("bash")) {
		throw new Error("PRETTY_DISABLE_TOOLS overrides pi-pretty.json and omits bash. Add bash to that comma-separated list or unset PRETTY_DISABLE_TOOLS, then rerun install:pi. No files were changed.");
	}
	if (env.PRETTY_CONFIG_DIR === "") throw new Error("PRETTY_CONFIG_DIR is empty; set a directory or unset it before installing.");
	// Pretty's default follows HOME, independently of PI_CODING_AGENT_DIR.
	const path = resolve(join(env.PRETTY_CONFIG_DIR ?? join(env.HOME ?? homedir(), ".pi", "agent"), "pi-pretty.json"));
	const initial = await readConfig(path);
	const planned = await plannedAdditions(initial.config, env);
	let applied;
	return {
		preview: { path, disableTools: planned.bash
			? [...(initial.config.disableTools ?? []), "bash"] : initial.config.disableTools,
			...(planned.theme && { theme: planned.theme }),
			changed: planned.bash || Boolean(planned.theme) },
		async apply() {
			// Re-read under the install transaction, retaining edits since preview.
			const before = await readConfig(path);
			const added = await plannedAdditions(before.config, env);
			if (!added.bash && !added.theme) return;
			const after = { ...before.config };
			if (added.theme) after.theme = added.theme;
			if (added.bash) after.disableTools = [...(before.config.disableTools ?? []), "bash"];
			const text = `${JSON.stringify(after, null, 2)}\n`;
			await mkdir(dirname(before.destination), { recursive: true });
			await writeConfig(before.destination, text);
			applied = { before, text, added };
		},
		async rollback() {
			if (!applied) return;
			const { before, added } = applied;
			// Recover the file we published even if its alias now points elsewhere.
			const current = await readConfig(before.destination, false);
			if (current.destination !== before.destination) throw new Error(`${path}: configuration target changed since installation; cannot roll back through a new link.`);
			if (current.text === undefined) { applied = undefined; return; }
			if (current.text !== applied.text) {
				// Revert only additions another writer left in place.
				let reverted = false;
				const index = added.bash && Array.isArray(current.config.disableTools) ? current.config.disableTools.indexOf("bash") : -1;
				if (index >= 0) {
					current.config.disableTools.splice(index, 1);
					if (!current.config.disableTools.length && !Object.hasOwn(before.config, "disableTools")) delete current.config.disableTools;
					reverted = true;
				}
				if (added.theme && current.config.theme === added.theme) {
					delete current.config.theme;
					reverted = true;
				}
				if (!reverted) { applied = undefined; return; }
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
