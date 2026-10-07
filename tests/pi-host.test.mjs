import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { createWorkspace, packageRoot } from "./helpers/pi-host.mjs";

const HOST_NAME = "@earendil-works/pi-coding-agent";
const HOST_MODULE = pathToFileURL(join(packageRoot, "scripts/pi-host.mjs")).href;
const PROBE = `import { findHostRoot } from ${JSON.stringify(HOST_MODULE)}; console.log(await findHostRoot());`;

function withoutHostOverride(environment) {
	const env = { ...environment };
	delete env.PI_TEST_PACKAGE_DIR;
	return env;
}

async function hostFixture(t, name = HOST_NAME) {
	const root = await realpath(await createWorkspace(t));
	const host = join(root, "virtual-store", "node_modules", HOST_NAME);
	await mkdir(join(host, "dist"), { recursive: true });
	await writeFile(join(host, "package.json"), JSON.stringify({ name }));
	await writeFile(join(host, "dist/cli.js"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
	return { root, host };
}

for (const layout of ["symlink", "pnpm-shim"]) {
	test(`shouldDiscoverPathSelectedHostWithoutOverrideWhenExecutableIs${layout}`, async (t) => {
		// Given
		const { root, host } = await hostFixture(t);
		const bin = join(root, "node_modules", ".bin");
		await mkdir(bin, { recursive: true });
		if (layout === "symlink") await symlink(join(host, "dist/cli.js"), join(bin, "pi"));
		else {
			await mkdir(join(root, "node_modules", "@earendil-works"));
			await symlink(host, join(root, "node_modules", HOST_NAME));
			await writeFile(join(bin, "pi"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
		}
		const env = withoutHostOverride({ ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` });
		// When
		const result = spawnSync(process.execPath, ["--input-type=module", "-e", PROBE], { cwd: root, env, encoding: "utf8" });
		// Then
		assert.equal(result.status, 0, result.stderr);
		assert.equal(result.stdout.trim(), host);
	});
}

test("shouldRejectWrongSiblingPackageWhenSelectedShimHasNoPiHost", async (t) => {
	// Given
	const { root, host } = await hostFixture(t, "not-the-pi-host");
	const bin = join(root, "node_modules", ".bin");
	await mkdir(bin, { recursive: true });
	await mkdir(join(root, "node_modules", "@earendil-works"));
	await symlink(host, join(root, "node_modules", HOST_NAME));
	await writeFile(join(bin, "pi"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
	const env = withoutHostOverride({ ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` });
	// When
	const result = spawnSync(process.execPath, ["--input-type=module", "-e", PROBE], { cwd: root, env, encoding: "utf8" });
	// Then
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Cannot locate the installed Pi package/);
});

test("shouldHonorExplicitOverrideWhenPiExecutableIsUnavailable", async (t) => {
	// Given
	const root = await createWorkspace(t);
	const env = { ...process.env, PATH: "", PI_TEST_PACKAGE_DIR: root };
	// When
	const result = spawnSync(process.execPath, ["--input-type=module", "-e", PROBE], { env, encoding: "utf8" });
	// Then
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout.trim(), resolve(root));
});

test("shouldPreviewAndInstallViaPnpmWhenSdkOverrideIsAbsent", { timeout: 20_000 }, async (t) => {
	// Given
	const root = await realpath(await createWorkspace(t));
	const cwd = join(root, "consumer"), agent = join(root, "agent"), home = join(root, "home");
	await mkdir(join(cwd, ".git"), { recursive: true });
	await mkdir(agent); await mkdir(home);
	await writeFile(join(agent, "settings.json"), '{"packages":[]}');
	const env = withoutHostOverride({ ...process.env, HOME: home, PI_CODING_AGENT_DIR: agent,
		PRETTY_CONFIG_DIR: agent, PRETTY_DISABLE_TOOLS: "", PI_OFFLINE: "1", PI_TELEMETRY: "0" });
	const run = (...args) => execFileSync("pnpm", ["--silent", "run", "install:pi", "--local", "--cwd", cwd, ...args], {
		cwd: packageRoot, env, encoding: "utf8", timeout: 15_000,
	});
	// When
	const help = run("--help");
	const preview = JSON.parse(run("--dry-run"));
	// Never migrate any skill if isolation is not complete.
	assert.deepEqual({ moves: preview.moves, blockers: preview.blockers }, { moves: [], blockers: [] });
	const output = run("--without-pretty");
	const receipt = JSON.parse(output.slice(output.lastIndexOf('{\n  "installed"')));
	const settings = JSON.parse(await readFile(join(cwd, ".pi/settings.json"), "utf8"));
	// Then
	assert.match(help, /^Usage: pnpm run install:pi \[--local\]/);
	assert.deepEqual({ verified: receipt.verifiedSkills, companions: receipt.companionPackages }, { verified: 56, companions: [] });
	assert.ok(settings.packages.some((entry) => resolve(cwd, ".pi", typeof entry === "string" ? entry : entry.source) === resolve(packageRoot)));
	assert.equal(preview.prettyConfig.path, join(agent, "pi-pretty.json"));
});
