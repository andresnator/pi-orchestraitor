import { readFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CORE_INSTRUCTIONS = new URL("../instructions/core.md", import.meta.url);
const ORCHESTRAITOR_INSTRUCTIONS = new URL("../instructions/orchestraitor.md", import.meta.url);
const PERSONALITY_INSTRUCTIONS = new URL("../instructions/personality.md", import.meta.url);
// Pi's native docs rule asks for whole files, a large share of recorded codemode output.
const READ_WHOLE_DOCS = "- Always read pi .md files completely and follow links to related docs";
const READ_RELEVANT_DOCS = "- In pi .md files, list the headings first, then read the relevant sections completely and follow links to related docs";
const DOCS_SECTION = /(?:^|\n)<docs>\n([\s\S]*?)\n<\/docs>(?:\n|$)/;

/** Add owned sections without replacing Pi's prompt, tools or project context; only Pi's docs reading rule is narrowed. */
export default async function instructions(pi: ExtensionAPI) {
	const [core, orchestraitor, personality] = await Promise.all([
		readFile(CORE_INSTRUCTIONS, "utf8"),
		readFile(ORCHESTRAITOR_INSTRUCTIONS, "utf8"),
		readFile(PERSONALITY_INSTRUCTIONS, "utf8"),
	]);
	pi.on("before_agent_start", (event) => {
		// A same-name section replaces Pi's native one in place. Without the exact rule, Pi's section stays as is.
		const docs = DOCS_SECTION.exec(event.systemPrompt)?.[1];
		if (docs?.includes(READ_WHOLE_DOCS)) event.systemPromptOptions.sections.docs = docs.replace(READ_WHOLE_DOCS, READ_RELEVANT_DOCS);
		event.systemPromptOptions.sections.pi_orchestraitor_core = core;
		event.systemPromptOptions.sections.pi_orchestraitor_execution = orchestraitor;
		event.systemPromptOptions.sections.pi_orchestraitor_personality = personality;
	});
}
