import { realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { importTui } from "../../scripts/pi-host.mjs";
import { readWorkbenchSnapshot, workbenchPaths } from "../../extensions/ui/workbench-bridge.mjs";
import { createWorkbenchApp } from "./app.mjs";
import { selectPalette } from "./palette.mjs";
export const POLL_INTERVAL_MS = 250;

/** Read-only process loop; injected terminal and reader also exercise native TUI offline. */
export async function startWorkbench({ ui, terminal = new ui.ProcessTerminal(), palette = "nord", read, onQuit = () => {}, onError = () => {}, initialState, onLayout }) {
	const selected = selectPalette(palette);
	const app = createWorkbenchApp(ui, { palette: selected.name, colorMode: selected.mode, getRows: () => terminal.rows, initialState });
	const renderer = new ui.TuiAltScreen(terminal, false, undefined, { copyOnSelect: false });
	let stopped = false, polling = false, relocating = false, interval, resizeTimer;
	const originalStart = terminal.start;
	if (onLayout) terminal.start = function(input, resize) {
		return originalStart.call(this, input, () => {
			resize(); clearTimeout(resizeTimer);
			resizeTimer = setTimeout(async () => {
				if (stopped || relocating) return;
				relocating = true;
				try { await onLayout(app.exportState()); } catch (error) { onError(error); }
				finally { relocating = false; }
			}, 750); resizeTimer.unref?.();
		});
	};
	const stop = () => {
		if (stopped) return;
		stopped = true; clearInterval(interval); clearTimeout(resizeTimer);
		terminal.start = originalStart;
		renderer.stop();
	};
	async function poll() {
		if (stopped || polling) return;
		polling = true;
		try { const result = await read(); if (!stopped) { app.update(result); renderer.requestRender(); } }
		catch { if (!stopped) { app.update({ status: "error" }); renderer.requestRender(); } }
		finally { polling = false; }
	}
	renderer.setLayoutRoot(app.root);
	renderer.setFocus({ focused: true, render: () => [], invalidate() {}, handleInput(data) {
		try {
			if (app.handleInput(data) === "quit") { stop(); Promise.resolve(onQuit(app.exportState())).catch(onError); }
			else renderer.requestRender();
		} catch (error) { stop(); onError(error); }
	} });
	try {
		renderer.start();
		interval = setInterval(() => void poll(), POLL_INTERVAL_MS); interval.unref?.();
		void poll();
	} catch (error) { stop(); throw error; }
	return { app, stop, poll };
}

// The manifest bootstrap launches a real argv-identifiable renderer process,
// rather than relying on a title, shell PID or interpolated command string.
export async function launchPane(env = process.env) {
	const args = [fileURLToPath(import.meta.url), "--socket", env.PI_WORKBENCH_SOCKET, "--origin", env.PI_WORKBENCH_ORIGIN,
		"--source", env.PI_WORKBENCH_SOURCE, "--token", env.PI_WORKBENCH_TOKEN];
	const palette = env.PI_WORKBENCH_PALETTE ?? "nord";
	if (!["nord", "light", "mono"].includes(palette)) throw new Error("Unknown workbench launch palette");
	args.push("--palette", palette);
	if (args.some(value => typeof value !== "string" || !value || value.length > 1000)) throw new Error("Missing companion launch identity");
	const child = spawn(process.execPath, args, { stdio: "inherit", env });
	for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
	await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", code => { process.exitCode = code ?? 1; resolve(); }); });
}
function lifecycleAction(action, state) {
	return new Promise((resolve, reject) => {
		// Relocation must survive closure of its old renderer, but is bounded by
		// the action process's 15-second deadline. No agents or models are spawned.
		const child = spawn(process.execPath, [fileURLToPath(new URL("./actions.mjs", import.meta.url)), action, "--caller", process.env.HERDR_PANE_ID],
			{ detached: true, stdio: "ignore", env: { ...process.env, PI_WORKBENCH_VIEW_STATE: JSON.stringify(state) } });
		child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error("Owned pane action failed; retry explicitly")));
	});
}

export async function main(args = process.argv.slice(2)) {
	if (args.length === 1 && args[0] === "--help") {
		console.log("Read-only Herdr companion. Launch through the pi.orchestraitor plugin after enabling /orchestraitor:workbench in Pi.\nInternal options: --socket PATH --origin ID --source INSTANCE --token TOKEN [--palette nord|light|mono]");
		return;
	}
	const values = {};
	for (let index = 0; index < args.length; index += 2) {
		const key = args[index];
		if (!["--socket", "--origin", "--source", "--token", "--palette"].includes(key) || Object.hasOwn(values, key) || typeof args[index + 1] !== "string" || args[index + 1].length > 1000 || /[\x00-\x1f\x7f-\x9f]/.test(args[index + 1])) throw new Error("Invalid companion launch options");
		values[key] = args[index + 1];
	}
	if (!["--socket", "--origin", "--source", "--token"].every(key => values[key]) || !process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Launch the companion from its native Herdr plugin in an interactive terminal");
	const socket = await realpath(values["--socket"]);
	const paths = await workbenchPaths(socket, values["--origin"]);
	let expected = { instance: values["--source"], pane: values["--origin"], socket };
	const local = process.env.PI_WORKBENCH_VIEW_STATE;
	if (local && Buffer.byteLength(local) > 65536) throw new Error("Oversized local view state");
	let runtime, layoutFailed = false;
	const finish = () => { runtime?.stop(); process.stdin.pause(); };
	const fail = () => { finish(); process.exitCode = 1; console.error("Workbench stopped after a terminal error. Native Pi execution is unchanged."); };
	try {
		runtime = await startWorkbench({ ui: await importTui(), palette: values["--palette"] ?? "nord", initialState: local ? JSON.parse(local) : undefined,
			onLayout: async state => { try { await lifecycleAction("relocate", state); layoutFailed = false; } catch { layoutFailed = true; } },
			read: async () => {
				if (layoutFailed) return { status: "error" };
				const result = await readWorkbenchSnapshot(paths, { expected });
				if (result.status === "live") expected = result.snapshot.publisher;
				return result;
			}, onQuit: async state => { await lifecycleAction("close", state); finish(); }, onError: fail });
		process.once("SIGINT", finish); process.once("SIGTERM", finish);
		process.once("uncaughtException", fail); process.once("unhandledRejection", fail);
		process.once("exit", finish);
	} catch (error) { finish(); throw error; }
}

if (process.argv[1] && pathToFileURL(await realpath(process.argv[1])).href === import.meta.url) {
	try { await main(); } catch { console.error("Workbench could not start. Check the compatible Pi host, Herdr origin and launch options; no dependencies were installed."); process.exitCode = 1; }
}
