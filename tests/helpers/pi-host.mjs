import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveHostPath } from "./host-path.mjs";

export const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const EXPECTED_HOST_NAME = "@earendil-works/pi-coding-agent";

// Keep SDK defaults away from personal auth, sessions and model caches.
export const isolatedAgentDir = await mkdtemp(join(tmpdir(), "pi-orchestraitor-agent-"));
process.env.PI_CODING_AGENT_DIR = isolatedAgentDir;
process.env.PI_OFFLINE = "1";
process.env.PI_TELEMETRY = "0";
after(() => rm(isolatedAgentDir, { recursive: true, force: true }));

export const hostRoot = await findHostRoot();
// Installer subprocesses must use the same SDK as these fixtures.
process.env.PI_TEST_PACKAGE_DIR = hostRoot;
export const importHost = (path) => import(pathToFileURL(resolveHostPath(hostRoot, path)).href);
export const pi = await importHost("dist/index.js");
export const { loadExtensions } = await importHost("dist/core/extensions/loader.js");

async function findHostRoot() {
	if (process.env.PI_TEST_PACKAGE_DIR) return realpath(resolve(process.env.PI_TEST_PACKAGE_DIR));
	try {
		return await realpath(join(packageRoot, "node_modules", EXPECTED_HOST_NAME));
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	const executable = execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
	let directory = dirname(await realpath(executable));
	while (true) {
		try {
			const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
			if (manifest.name === EXPECTED_HOST_NAME) return directory;
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		const parent = dirname(directory);
		if (parent === directory) throw new Error("Cannot locate Pi package; set PI_TEST_PACKAGE_DIR.");
		directory = parent;
	}
}

export async function createWorkspace(t) {
	const cwd = await mkdtemp(join(tmpdir(), "pi-orchestraitor-workspace-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	return cwd;
}

export async function loadPackage(cwd, options = {}) {
	const settingsManager = pi.SettingsManager.inMemory({
		packages: [options.packagePath ?? packageRoot],
		...options.settings,
	});
	const loader = new pi.DefaultResourceLoader({
		cwd,
		agentDir: isolatedAgentDir,
		settingsManager,
		noSkills: true,
		additionalSkillPaths: options.loadSkills ? [join(options.packagePath ?? packageRoot, "skills")] : [],
		noThemes: true,
		noContextFiles: true,
		extensionFactories: options.extensionFactories ?? [],
	});
	await loader.reload();
	return { loader, settingsManager };
}

export async function startSession(t, cwd, resources) {
	const { session } = await pi.createAgentSession({
		cwd,
		agentDir: isolatedAgentDir,
		settingsManager: resources.settingsManager,
		resourceLoader: resources.loader,
		sessionManager: pi.SessionManager.inMemory(cwd),
	});
	let closed = false;
	const close = async () => {
		if (closed) return;
		closed = true;
		try {
			await session.extensionRunner.emit({ type: "session_shutdown" });
		} finally {
			session.dispose();
		}
	};
	t.after(close);
	const errors = [];
	await session.bindExtensions({ onError: (error) => errors.push(error) });
	return { session, errors, close };
}

export async function mcpStatus(session) {
	const notifications = [];
	const context = session.extensionRunner.createCommandContext();
	await session.extensionRunner.getCommand("mcp").handler("", {
		...context,
		mode: "print",
		ui: { ...context.ui, notify: (message) => notifications.push(message) },
	});
	return notifications.join("\n");
}
