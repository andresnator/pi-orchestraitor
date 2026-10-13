import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CONTEXT7_URL = "https://mcp.context7.com/mcp";
const ENGRAM_COMMAND = "engram";
// Engram's own tool name, as packages such as gentle-engram register it. Tools of this package's route are named mcp__engram__*.
const MEMORY_TOOL = "mem_search";

/** Session defaults only. Pi owns connections, overrides, errors and shutdown. */
export default function mcp(pi: ExtensionAPI) {
	pi.registerMcpServer("context7", {
		url: CONTEXT7_URL,
		exposure: "codemode",
		description: "Current documentation for libraries, frameworks, SDKs, APIs and CLI tools.",
	});
	// Every extension has loaded by session_start, so another package's Engram tools are visible whatever the load order.
	// A second route to the same memory would only duplicate them. Registering again would reconnect the server.
	pi.on("session_start", () => {
		if (pi.getMcpServers().some(({ name }) => name === "engram")) return;
		if (pi.getAllTools().some(({ name }) => name === MEMORY_TOOL)) return;
		pi.registerMcpServer("engram", {
			command: ENGRAM_COMMAND,
			args: ["mcp", "--tools=agent"],
			cwd: ".",
			exposure: "codemode",
			description: "Persistent project-scoped memory: search prior decisions and save verified findings.",
		});
	});
}
