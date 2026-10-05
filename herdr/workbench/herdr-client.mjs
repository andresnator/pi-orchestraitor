import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
export const PLUGIN_ID = "pi.orchestraitor";
export const ENTRYPOINT = "workbench";
export const HERDR_TIMEOUT_MS = 2500;
export const HERDR_MAX_BYTES = 262144;
export const isIdentity = value => typeof value === "string" && value.length > 0 && value.length <= 1000 && !/[\x00-\x1f\x7f-\x9f]/.test(value);

export async function invocationContext(env = process.env, explicitOrigin) {
	if (env.HERDR_ENV !== "1" || ![env.HERDR_SOCKET_PATH, env.HERDR_PANE_ID, env.HERDR_WORKSPACE_ID, env.HERDR_TAB_ID].every(isIdentity)) throw new Error("A verified Herdr caller is required");
	if (explicitOrigin !== undefined) {
		if (explicitOrigin !== env.HERDR_PANE_ID) throw new Error("Explicit caller does not match the originating terminal");
	} else {
		if (env.HERDR_PLUGIN_ID !== PLUGIN_ID || typeof env.HERDR_PLUGIN_CONTEXT_JSON !== "string" || Buffer.byteLength(env.HERDR_PLUGIN_CONTEXT_JSON) > 16384) throw new Error("Missing native plugin context");
		const context = JSON.parse(env.HERDR_PLUGIN_CONTEXT_JSON ?? "null");
		if (context?.invocation_source !== "keybinding" || context.focused_pane_id !== env.HERDR_PANE_ID || context.workspace_id !== env.HERDR_WORKSPACE_ID || context.tab_id !== env.HERDR_TAB_ID) throw new Error("Ambiguous action context; use the native keybinding or the explicit-caller CLI fallback");
	}
	return { socket: await realpath(env.HERDR_SOCKET_PATH), pane: env.HERDR_PANE_ID, workspace: env.HERDR_WORKSPACE_ID, tab: env.HERDR_TAB_ID };
}

export async function createHerdrClient({ env = process.env, run = promisify(execFile) } = {}) {
	const mainPath = await realpath(fileURLToPath(new URL("./main.mjs", import.meta.url)));
	const socket = await realpath(env.HERDR_SOCKET_PATH);
	async function request(args, type) {
		if (!args.every(isIdentity)) throw new Error("Invalid Herdr arguments");
		let output;
		try { output = (await run(env.HERDR_BIN_PATH || "herdr", args, { env: { ...env, HERDR_SOCKET_PATH: socket }, timeout: HERDR_TIMEOUT_MS, maxBuffer: HERDR_MAX_BYTES, encoding: "utf8" })).stdout; }
		catch (error) {
			let response;
			try { response = JSON.parse(error.stderr); } catch { throw new Error("Herdr command failed or exceeded its deadline"); }
			const failure = new Error("Herdr rejected the requested pane operation");
			failure.code = response.error?.code; throw failure;
		}
		const response = JSON.parse(output);
		if (response.error || response.result?.type !== type) throw new Error("Unexpected Herdr response envelope");
		return response.result;
	}
	return { mainPath,
		async pane(id) { try { return (await request(["pane", "get", id], "pane_info")).pane; } catch (error) { if (error.code === "pane_not_found") return undefined; throw error; } },
		async layout(id) { return (await request(["pane", "layout", "--pane", id], "pane_layout")).layout; },
		async processes(id) { return (await request(["pane", "process-info", "--pane", id], "pane_process_info")).process_info; },
		async open(source, direction, token, state) {
			const args = ["plugin", "pane", "open", "--plugin", PLUGIN_ID, "--entrypoint", ENTRYPOINT, "--placement", "split", "--target-pane", source.pane, "--direction", direction, "--cwd", source.project, "--no-focus"];
			for (const [key, value] of Object.entries({ PI_WORKBENCH_SOCKET: source.socket, PI_WORKBENCH_ORIGIN: source.pane, PI_WORKBENCH_SOURCE: source.instance, PI_WORKBENCH_TOKEN: token, PI_WORKBENCH_PALETTE: env.PI_WORKBENCH_PALETTE ?? "nord" })) args.push("--env", `${key}=${value}`);
			// Navigation state is bounded and validated by the new renderer; it contains no task text.
			if (state !== undefined) {
				const encoded = JSON.stringify(state);
				if (Buffer.byteLength(encoded) > 65536) throw new Error("Oversized local view state");
				args.push("--env", `PI_WORKBENCH_VIEW_STATE=${encoded}`);
			}
			// Only the bounded local-state argument may exceed the normal identity limit.
			const result = await requestOpen(args);
			return result.plugin_pane;
		},
		async focus(id) { return (await request(["plugin", "pane", "focus", id], "plugin_pane_focused")).plugin_pane; },
		async close(id) { return (await request(["plugin", "pane", "close", id], "plugin_pane_closed")).pane_id; },
		async focusOrigin(companion, direction, origin) {
			const neighbor = (await request(["pane", "neighbor", "--pane", companion, "--direction", direction], "pane_neighbor")).neighbor;
			if (neighbor?.neighbor_pane_id !== origin) throw new Error("Origin is no longer the verified neighbor");
			const focus = (await request(["pane", "focus", "--pane", companion, "--direction", direction], "pane_focus_direction")).focus;
			if (focus?.focused_pane_id !== origin) throw new Error("Origin focus was not confirmed");
		},
		async resize(id, direction, amount) { return (await request(["pane", "resize", "--pane", id, "--direction", direction, "--amount", String(amount)], "pane_resize")).resize?.layout; },
	};
	async function requestOpen(args) {
		// Local-state forwarding is a single argv value, never executable shell text.
		if (args.some(value => typeof value !== "string" || /[\x00-\x1f\x7f-\x9f]/.test(value) || value.length > 65580)) throw new Error("Invalid pane launch argument");
		let result;
		try { result = await run(env.HERDR_BIN_PATH || "herdr", args, { env: { ...env, HERDR_SOCKET_PATH: socket }, timeout: HERDR_TIMEOUT_MS, maxBuffer: HERDR_MAX_BYTES, encoding: "utf8" }); }
		catch { throw new Error("Pane open was not confirmed; inspect its owned runtime lease before retrying"); }
		const response = JSON.parse(result.stdout);
		if (response.error || response.result?.type !== "plugin_pane_opened") throw new Error("Unconfirmed pane launch; inspect the owned runtime lease before retrying");
		return response.result;
	}
}
