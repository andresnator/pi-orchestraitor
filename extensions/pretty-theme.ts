import { applyPrettyTheme } from "./pretty/theme.mjs";

/** Configuration only, on every start and reload: Pretty reads `PRETTY_THEME` when it first highlights, so any load order works. */
export default function prettyTheme() {
	applyPrettyTheme(process.env);
}
