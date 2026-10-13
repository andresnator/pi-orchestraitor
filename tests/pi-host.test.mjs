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

for (const state of ["valid", "missing", "traversal", "mismatch"]) {
	test(`shouldResolveOnlySelectedManagedReleaseWhenStateIs${state}`, async t => {
		const { root, host: oldHost } = await hostFixture(t);
		const agent = join(root, "agent"), bin = join(agent, "bin"), install = join(agent, "install");
		const host = join(install, "releases/1.2.0/node_modules", HOST_NAME);
		await mkdir(bin, { recursive: true });
		await mkdir(install, { recursive: true });
		await writeFile(join(bin, "pi"), "#!/bin/sh\n# install/current-version\nPI_MANAGED_INSTALL_ROOT=$pi_agent_dir/install\n", { mode: 0o755 });
		await writeFile(join(install, "current-version"), state === "traversal" ? "../../old\n" : "1.2.0\n");
		if (state !== "missing") {
			await mkdir(host, { recursive: true });
			await writeFile(join(host, "package.json"), JSON.stringify({ name: HOST_NAME, version: state === "mismatch" ? "1.0.4" : "1.2.0" }));
		}
		// A stale SDK beside the launcher must never win over managed release discovery.
		await mkdir(join(agent, "node_modules/@earendil-works"), { recursive: true });
		await symlink(oldHost, join(agent, "node_modules", HOST_NAME));
		const result = spawnSync(process.execPath, ["--input-type=module", "-e", PROBE], {
			env: withoutHostOverride({ ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` }), encoding: "utf8",
		});
		if (state === "valid") { assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), host); }
		else { assert.notEqual(result.status, 0); assert.match(result.stderr, /managed Pi|Managed Pi/); }
	});
}

test("shouldPreviewManagedSdkAndRefuseUnvalidatedActivationWhenSdkOverrideIsAbsent", { timeout: 20_000 }, async (t) => {
	// Given
	const root = await realpath(await createWorkspace(t));
	const cwd = join(root, "consumer"), agent = join(root, "agent"), home = join(root, "home");
	await mkdir(join(cwd, ".git"), { recursive: true });
	await mkdir(agent); await mkdir(home);
	await writeFile(join(agent, "settings.json"), '{"packages":[]}');
	const env = withoutHostOverride({ ...process.env, HOME: home, PI_CODING_AGENT_DIR: agent,
		PRETTY_CONFIG_DIR: agent, PRETTY_DISABLE_TOOLS: "", PI_OFFLINE: "1", PI_TELEMETRY: "0" });
	const run = (...args) => execFileSync(process.execPath, [join(packageRoot, "scripts/install-pi.mjs"), "--local", "--cwd", cwd, ...args], {
		cwd: packageRoot, env, encoding: "utf8", timeout: 15_000,
	});
	// When
	const help = run("--help");
	const preview = JSON.parse(run("--dry-run"));
	// Never migrate any skill if isolation is not complete.
	assert.deepEqual({ moves: preview.moves, blockers: preview.blockers }, { moves: [], blockers: [] });
	assert.throws(() => run("--without-pretty"), /Activation requires --subagents-validation/);
	assert.match(help, /^Usage: pnpm run install:pi/);
	assert.deepEqual(preview.companionPackages, ["npm:@heyhuynhgiabuu/pi-pretty@0.6.30", "npm:pi-claude-bridge@0.9.2", "npm:pi-subagents@0.78.0"]);
	assert.equal(preview.prettyConfig.path, join(agent, "pi-pretty.json"));
});
