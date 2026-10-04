import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	createWorkspace, importHost, isolatedAgentDir, loadExtensions, loadPackage, packageRoot, pi, startSession,
} from "./pi-host.mjs";

export { createWorkspace, importHost, loadExtensions, packageRoot, pi } from "./pi-host.mjs";
export const tui = await importHost("node_modules/@earendil-works/pi-tui/dist/index.js");
export const plainTheme = { fg: (_token, text) => text, bg: (_token, text) => text, bold: (text) => text };

// Use Pi's actual TypeScript/module mapping, not a second host discovery mechanism.
export async function loadUiModule(t, relativePath) {
	const cwd = await createWorkspace(t);
	const probe = join(cwd, "ui-module-probe.ts");
	await writeFile(probe, `import * as subject from ${JSON.stringify(join(packageRoot, relativePath))};
import { Type } from "typebox";
export default function(pi) {
	pi.registerTool({name:"ui_probe", label:"Probe", description:"Test only", parameters:Type.Object({}),
		execute:async () => ({content:[], details:subject})});
}`);
	const loaded = await loadExtensions([probe], cwd);
	assert.deepEqual(loaded.errors, []);
	return (await loaded.extensions[0].tools.get("ui_probe").definition.execute("probe", {})).details;
}

export async function createUISession(t, mode = "tui", options = {}) {
	const cwd = await createWorkspace(t);
	const resources = await loadPackage(cwd, { ...options, settings: { packages: [{
		source: packageRoot, extensions: ["extensions/status-ui.ts"], skills: [], prompts: [],
	}] } });
	const bound = await startSession(t, cwd, resources);
	const ui = fakeUIContext(mode);
	bound.session.extensionRunner.setUIContext(ui.ctx.ui, mode);
	await bound.session.extensionRunner.emit({ type: "session_start", reason: "startup" });
	return { ...bound, ...ui, resources };
}

export async function createPackageUISession(t, mode = "tui", options = {}) {
	const cwd = await createWorkspace(t);
	const disabledMcp = pi.createMcpExtension({
		loadConfig: () => ({ errors: [], servers: [
			{ name: "context7", config: { url: "https://example.invalid", enabled: false }, source: "fixture" },
			{ name: "engram", config: { command: "engram", enabled: false }, source: "fixture" },
		] }),
		createTransport: () => { throw new Error("No live service connection allowed in UI integration tests"); },
	});
	const resources = await loadPackage(cwd, { ...options, extensionFactories: [disabledMcp, ...(options.extensionFactories ?? [])] });
	const bound = options.selection ? await startSelectedSession(t, cwd, resources, options.selection) : await startSession(t, cwd, resources);
	const ui = fakeUIContext(mode);
	bound.session.extensionRunner.setUIContext(ui.ctx.ui, mode);
	await bound.session.extensionRunner.emit({ type: "session_start", reason: "startup" });
	return { ...bound, ...ui, resources };
}

async function startSelectedSession(t, cwd, resources, selection) {
	const { session } = await pi.createAgentSession({ cwd, agentDir: isolatedAgentDir,
		settingsManager: resources.settingsManager, resourceLoader: resources.loader,
		sessionManager: pi.SessionManager.inMemory(cwd), ...selection });
	let closed = false;
	const close = async () => {
		if (closed) return;
		closed = true;
		try { await session.extensionRunner.emit({ type: "session_shutdown" }); }
		finally { session.dispose(); }
	};
	t.after(close);
	const errors = [];
	await session.bindExtensions({ onError: (error) => errors.push(error) });
	return { session, errors, close };
}

export function fakeUIContext(mode = "tui") {
	const widgets = new Map([["foreign-widget", ["Foreign widget"]]]);
	const statuses = new Map([["foreign-status", "Foreign status"]]);
	const calls = [];
	const dialogs = [];
	const ctx = {
		mode, hasUI: mode === "tui" || mode === "rpc",
		ui: {
			theme: plainTheme,
			setWidget(key, value) { calls.push(["widget", key, value]); value === undefined ? widgets.delete(key) : widgets.set(key, value); },
			setStatus(key, value) { calls.push(["status", key, value]); value === undefined ? statuses.delete(key) : statuses.set(key, value); },
			notify(message, level) { calls.push(["notify", message, level]); },
			custom(factory) {
				return new Promise((resolve, reject) => {
					let component;
					let closed = false;
					const done = (value) => {
						if (closed) return;
						closed = true;
						resolve(value);
						component?.dispose?.();
					};
					try {
						component = factory({ requestRender() {}, terminal: { rows: 24, columns: 80 } },
							plainTheme, { matches: () => false }, done);
						if (closed) component?.dispose?.();
						dialogs.push({ component, done });
					} catch (error) { reject(error); }
				});
			},
		},
		sessionManager: pi.SessionManager.inMemory(),
	};
	return { ctx, widgets, statuses, calls, dialogs };
}
