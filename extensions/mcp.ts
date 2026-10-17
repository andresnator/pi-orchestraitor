import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CONTEXT7_URL = "https://mcp.context7.com/mcp";
const ENGRAM_COMMAND = "engram";
// The only memory tools the model can reach; every other Engram tool stays hidden. Codemode keeps their schemas out of the prompt.
const ENGRAM_TOOLS = ["mem_search", "mem_save", "mem_context", "mem_get_observation"] as const;

/** Session defaults only. Pi owns connections, overrides, errors and shutdown. */
export default function mcp(pi: ExtensionAPI) {
	pi.registerMcpServer("context7", {
		url: CONTEXT7_URL,
		exposure: "codemode",
		description: "Current documentation for libraries, frameworks, SDKs, APIs and CLI tools.",
	});
	pi.registerMcpServer("engram", {
		command: ENGRAM_COMMAND,
		args: ["mcp", "--tools=agent"],
		cwd: ".",
		exposure: "hidden",
		toolExposure: Object.fromEntries(ENGRAM_TOOLS.map((name) => [name, "codemode"])),
		description: "Persistent project-scoped memory: search prior decisions and save verified findings.",
	});
}
