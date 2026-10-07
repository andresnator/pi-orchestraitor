import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { importHost, packageRoot } from "./helpers/pi-host.mjs";

const { parse, parseAllDocuments } = await importHost("node_modules/yaml/dist/index.js");
const HOST_NAME = "@earendil-works/pi-coding-agent";

test("shouldLockDevelopmentHostAndDenyUnreviewedBuildsWhenPnpmInstalls", async () => {
	// Given
	const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
	const policy = parse(await readFile(join(packageRoot, "pnpm-workspace.yaml"), "utf8"));
	const documents = parseAllDocuments(await readFile(join(packageRoot, "pnpm-lock.yaml"), "utf8"));
	// When
	const lockfiles = documents.map((document) => {
		assert.deepEqual(document.errors, []);
		return document.toJS();
	});
	const projectLock = lockfiles.find((lock) => lock.importers?.["."]?.devDependencies?.[HOST_NAME]);
	const managerLock = lockfiles.find((lock) => lock.importers?.["."]?.packageManagerDependencies?.pnpm);
	// Then
	assert.deepEqual({ manager: manifest.packageManager, host: manifest.devDependencies[HOST_NAME], runtime: manifest.dependencies,
		peer: manifest.peerDependencies[HOST_NAME], private: manifest.private },
		{ manager: "pnpm@12.9.1", host: "1.0.4", runtime: { "beautiful-mermaid": "1.1.3" }, peer: "*", private: true });
	assert.deepEqual(policy, { autoInstallPeers: false, minimumReleaseAge: 1440, blockExoticSubdeps: true, strictDepBuilds: true,
		allowBuilds: { "@google/genai@2.21.0": false, "esbuild@0.28.2": false, "protobufjs@7.6.6": false } });
	assert.equal(projectLock.importers["."].devDependencies[HOST_NAME].specifier, "1.0.4");
	assert.match(projectLock.importers["."].devDependencies[HOST_NAME].version, /^1\.0\.4(?:\(|$)/);
	assert.equal(managerLock.importers["."].packageManagerDependencies.pnpm.version, "12.9.1");
	assert.ok(Object.values(projectLock.packages).every((pkg) => /^sha512-/.test(pkg.resolution.integrity)));
});

test("shouldUseFrozenLocalHostAndPinnedActionsWhenCiRuns", async () => {
	// Given
	const workflow = parse(await readFile(join(packageRoot, ".github/workflows/ci.yml"), "utf8"));
	// When
	const steps = workflow.jobs.test.steps;
	const commands = steps.filter((step) => step.run).map((step) => step.run);
	const actions = steps.filter((step) => step.uses);
	// Then
	assert.deepEqual(commands, ["pnpm install --frozen-lockfile", "pnpm exec pi --version", "pnpm test",
		"pnpm pack --dry-run --ignore-scripts", "git diff --exit-code -- pnpm-lock.yaml pnpm-workspace.yaml", "git show --format= --check HEAD"]);
	assert.equal(workflow.jobs.test["runs-on"], "ubuntu-24.04");
	assert.deepEqual(workflow.jobs.test.strategy.matrix.node, ["22.19.0", "24.20.0"]);
	assert.deepEqual(workflow.permissions, { contents: "read" });
	assert.equal(actions.length, 3);
	assert.ok(actions.every(({ uses }) => /@[a-f0-9]{40}$/.test(uses)));
	assert.equal(actions[0].with["persist-credentials"], false);
	assert.equal(actions[1].with["package-manager-cache"], false);
	assert.equal(actions[2].with.run_install, false);
});
