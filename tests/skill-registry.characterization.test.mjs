import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createWorkspace, isolatedAgentDir, pi } from "./helpers/pi-host.mjs";

const SKILL_NAME = "registry-gate-fixture";
const SKILL_BODY = `---\nname: ${SKILL_NAME}\ndescription: Isolated registry compatibility fixture.\n---\nRead the assigned fixture only.\n`;
const PROBE_FLAG = "registry-gate-probe";

async function createFixture(t) {
	const cwd = await createWorkspace(t);
	const skillDir = join(cwd, ".claude", "skills", SKILL_NAME);
	await mkdir(skillDir, { recursive: true });
	await writeFile(join(skillDir, "SKILL.md"), SKILL_BODY);
	return { cwd, skillDir };
}

async function createHost(t, cwd, skillsOverride) {
	let api;
	const settingsManager = pi.SettingsManager.inMemory({
		skills: [`!${join(homedir(), ".agents", "skills")}/**`],
	}, { projectTrusted: true });
	const loader = new pi.DefaultResourceLoader({
		cwd, agentDir: isolatedAgentDir, settingsManager,
		noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
		skillsOverride,
		extensionFactories: [(extensionApi) => {
			api = extensionApi;
			extensionApi.registerFlag(PROBE_FLAG, { description: "Isolated compatibility probe", type: "boolean", default: false });
		}],
	});
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const { session } = await pi.createAgentSession({
		cwd, agentDir: isolatedAgentDir, settingsManager, resourceLoader: loader,
		sessionManager: pi.SessionManager.inMemory(cwd),
	});
	t.after(async () => {
		try { await session.extensionRunner.emit({ type: "session_shutdown" }); }
		finally { session.dispose(); }
	});
	const errors = [];
	await session.bindExtensions({ mode: "print", onError: (error) => errors.push(error) });
	assert.deepEqual(errors, []);
	return { api, loader, session };
}

function extendSkillResources(loader, skillDir) {
	loader.extendResources({
		skillPaths: [{ path: skillDir, metadata: { source: "registry-gate-fixture", scope: "temporary", origin: "top-level" } }],
		promptPaths: [], themePaths: [],
	});
}

test("shouldKeepRejectedSkillsUnavailableWhenNativeDiscoveryReappliesHostOverrides", async (t) => {
	// Given
	const { cwd, skillDir } = await createFixture(t);
	const { loader } = await createHost(t, cwd, (result) => ({
		...result, skills: result.skills.filter(({ name }) => name !== SKILL_NAME),
	}));
	// When
	extendSkillResources(loader, skillDir);
	const scanned = pi.loadSkillsFromDir({ dir: skillDir, source: "registry-gate-fixture" });
	// Then
	assert.deepEqual({ nativeNames: loader.getSkills().skills.map(({ name }) => name), scannedNames: scanned.skills.map(({ name }) => name), diagnostics: scanned.diagnostics }, {
		nativeNames: [], scannedNames: [SKILL_NAME], diagnostics: [],
	});
});

test("shouldExposeIdenticalPublicSnapshotsWhenNativeHostsApplyDifferentFutureSkillPolicies", async (t) => {
	// Given
	const { cwd, skillDir } = await createFixture(t);
	const allowed = await createHost(t, cwd, (result) => result);
	const denied = await createHost(t, cwd, (result) => ({ ...result, skills: [] }));
	// When
	const allowedSnapshot = {
		settings: allowed.api.getSettings(),
		prompt: allowed.session.extensionRunner.createCommandContext().getSystemPromptOptions(),
	};
	const deniedSnapshot = {
		settings: denied.api.getSettings(),
		prompt: denied.session.extensionRunner.createCommandContext().getSystemPromptOptions(),
	};
	extendSkillResources(allowed.loader, skillDir);
	extendSkillResources(denied.loader, skillDir);
	// Then
	assert.deepEqual(allowedSnapshot, deniedSnapshot);
	assert.deepEqual({ allowedNames: allowed.loader.getSkills().skills.map(({ name }) => name), deniedNames: denied.loader.getSkills().skills.map(({ name }) => name) }, {
		allowedNames: [SKILL_NAME], deniedNames: [],
	});
});

test("shouldExposeMergedSettingsButNotNativeLoaderAccessWhenAnExtensionUsesPublicContext", async (t) => {
	// Given
	const { cwd } = await createFixture(t);
	const { api, session } = await createHost(t, cwd, (result) => result);
	const context = session.extensionRunner.createCommandContext();
	// When
	const capabilities = {
		registeredFlag: api.getFlag(PROBE_FLAG),
		nativeFlag: api.getFlag("no-skills"),
		settings: api.getSettings(),
		trusted: context.isProjectTrusted(),
		contextResourceLoader: typeof context.resourceLoader,
		contextSettingsManager: typeof context.settingsManager,
		apiResourceLoader: typeof api.resourceLoader,
		apiResolvedResources: typeof api.getResolvedResources,
	};
	// Then
	assert.deepEqual(capabilities, {
		registeredFlag: false,
		nativeFlag: undefined,
		settings: { skills: [`!${join(homedir(), ".agents", "skills")}/**`] },
		trusted: true,
		contextResourceLoader: "undefined",
		contextSettingsManager: "undefined",
		apiResourceLoader: "undefined",
		apiResolvedResources: "undefined",
	});
});
