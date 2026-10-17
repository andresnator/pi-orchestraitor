import { readFileSync } from "node:fs";
import { join } from "node:path";

// Pi's built-in themes are not Shiki themes: Pretty warns and highlights with github-dark.
const SHIKI_THEMES = new Map([["dark", "github-dark"], ["light", "github-light"]]);
// Survives /reload, so a value this module set is told apart from the user's own.
const OWNED = Symbol.for("pi-orchestraitor.pretty-theme");

function readJson(path) {
	try { return JSON.parse(readFileSync(path, "utf8")); }
	catch { return undefined; }
}

function shikiTheme(env) {
	const configDir = env.PRETTY_CONFIG_DIR ?? (env.HOME ? join(env.HOME, ".pi", "agent") : undefined);
	const configured = configDir ? readJson(join(configDir, "pi-pretty.json"))?.theme : undefined;
	if (typeof configured === "string" && configured.trim()) return;
	return env.HOME ? SHIKI_THEMES.get(readJson(join(env.HOME, ".pi", "agent", "settings.json"))?.theme) : undefined;
}

/**
 * Set `PRETTY_THEME` to the Shiki counterpart of Pi's built-in theme, following
 * Pretty's own order: an explicit `PRETTY_THEME` or `pi-pretty.json` theme wins,
 * then the theme in `$HOME/.pi/agent/settings.json`. Writes no files; each start
 * or reload replaces or removes only the value set here, so Pretty follows the
 * current Pi theme. Returns the theme it set, if any.
 */
export function applyPrettyTheme(env) {
	const owned = (globalThis[OWNED] ??= new WeakMap());
	if (env.PRETTY_THEME && env.PRETTY_THEME !== owned.get(env)) return;
	const theme = shikiTheme(env);
	if (theme) {
		env.PRETTY_THEME = theme;
		owned.set(env, theme);
	} else if (owned.delete(env)) delete env.PRETTY_THEME;
	return theme;
}
