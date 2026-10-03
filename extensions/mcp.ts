import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CONTEXT7_URL = "https://mcp.context7.com/mcp";
const ENGRAM_COMMAND = "engram";

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
		exposure: "codemode",
		description: "Persistent project-scoped memory: search prior decisions and save verified findings.",
	});
}
