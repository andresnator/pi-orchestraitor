import { readFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CORE_INSTRUCTIONS = new URL("../instructions/core.md", import.meta.url);
const ORCHESTRAITOR_INSTRUCTIONS = new URL("../instructions/orchestraitor.md", import.meta.url);
const PERSONALITY_INSTRUCTIONS = new URL("../instructions/personality.md", import.meta.url);

/** Add owned sections without replacing Pi's prompt, tools or project context. */
export default async function instructions(pi: ExtensionAPI) {
	const [core, orchestraitor, personality] = await Promise.all([
		readFile(CORE_INSTRUCTIONS, "utf8"),
		readFile(ORCHESTRAITOR_INSTRUCTIONS, "utf8"),
		readFile(PERSONALITY_INSTRUCTIONS, "utf8"),
	]);
	pi.on("before_agent_start", (event) => {
		event.systemPromptOptions.sections.pi_orchestraitor_core = core;
		event.systemPromptOptions.sections.pi_orchestraitor_execution = orchestraitor;
		event.systemPromptOptions.sections.pi_orchestraitor_personality = personality;
	});
}
