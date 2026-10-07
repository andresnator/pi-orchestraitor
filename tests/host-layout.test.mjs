import assert from "node:assert/strict";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { resolveHostPath } from "./helpers/host-path.mjs";
const requestedHost = process.env.PI_TEST_PACKAGE_DIR;
const { createWorkspace, hostRoot, packageRoot } = await import("./helpers/pi-host.mjs");

const HOST_NAME = "@earendil-works/pi-coding-agent";
const FIXTURE_DEPENDENCY = "@fixture/dependency/dist/index.js";

for (const layout of ["nested", "sibling"]) {
	test(`shouldResolveHostDependencyWithoutRepoHoistingWhenLayoutIs${layout}`, async (t) => {
		// Given
		const root = await createWorkspace(t);
		const host = join(root, "node_modules", "@fixture", "host");
		const dependency = join(layout === "nested" ? host : root, "node_modules", FIXTURE_DEPENDENCY);
		await mkdir(host, { recursive: true });
		await mkdir(join(dependency, ".."), { recursive: true });
		await writeFile(join(host, "package.json"), '{"name":"@fixture/host"}');
		await writeFile(dependency, "export const marker = true;");
		// When
		const result = resolveHostPath(host, `node_modules/${FIXTURE_DEPENDENCY}`);
		// Then
		assert.equal(result, dependency);
		assert.equal(resolveHostPath(host, "dist/index.js"), join(host, "dist/index.js"));
	});
}

test("shouldRejectMissingDependencyWhenHostFixtureHasNoMatchingModule", async (t) => {
	// Given
	const root = await createWorkspace(t);
	// When / Then
	assert.throws(() => resolveHostPath(root, "node_modules/@fixture/missing/dist/index.js"), /Cannot locate host dependency fixture/);
});

test("shouldSelectRequestedOrLockedHostWhenPnpmRunsRepositoryTests", async () => {
	// Given
	const expected = await realpath(requestedHost ?? join(packageRoot, "node_modules", HOST_NAME));
	// When / Then
	assert.equal(hostRoot, expected);
	assert.equal(process.env.PI_TEST_PACKAGE_DIR, expected);
});
