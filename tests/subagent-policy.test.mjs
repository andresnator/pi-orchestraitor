import assert from "node:assert/strict";
import { mkdir, writeFile, symlink, link, realpath } from "node:fs/promises";
import { join, win32 } from "node:path";
import test from "node:test";
import { createWorkspace } from "./helpers/pi-host.mjs";
import { validateBatch, validatePath, selectModel, concreteFile, protectedPath, projectRelativePath } from "../extensions/subagent/policy.mjs";

test("shouldRejectMixedAndUnboundedTasksWhenValidatingBatch", () => {
	// Given
	const reader = { role: "explore", instruction: "inspect" };
	const writer = { role: "implement", instruction: "fix", files: ["src/a.ts"] };
	// When / Then
	assert.doesNotThrow(() => validateBatch([reader, reader]));
	assert.doesNotThrow(() => validateBatch([writer]));
	for (const tasks of [[], [reader, reader, reader], [reader, writer], [writer, writer], [{ ...writer, files: [] }], [{ ...writer, files: ["../a"] }], [{ ...writer, files: [".git/config"] }]]) {
		assert.throws(() => validateBatch(tasks));
	}
});

test("shouldRejectEscapesAndUnsafeLinksWhenAccessingFiles", async (t) => {
	// Given
	const cwd = await realpath(await createWorkspace(t));
	const outside = await createWorkspace(t);
	await mkdir(join(cwd, "src"));
	await writeFile(join(cwd, "src/a"), "safe");
	await writeFile(join(outside, "secret"), "secret");
	await symlink(outside, join(cwd, "escape"));
	await link(join(cwd, "src/a"), join(cwd, "hard"));
	const manifest = { cwd, role: "implement", files: ["src/a", "new", "hard"], skills: [] };
	// When / Then
	assert.equal(await validatePath(manifest, "new", true), join(cwd, "new"));
	for (const path of ["../secret", "escape/secret", ".git/config", ".pi/settings.json", outside]) {
		await assert.rejects(validatePath(manifest, path, false));
	}
	for (const path of ["hard", "src/a", "unassigned"]) await assert.rejects(validatePath(manifest, path, true));
});

test("shouldInheritOrSelectExactAvailableModelWhenResolvingTask", () => {
	// Given
	const models = [{ provider: "p", id: "one" }, { provider: "p", id: "two" }];
	// When / Then
	assert.deepEqual(selectModel(undefined, models[0], models), models[0]);
	assert.deepEqual(selectModel("p/two", models[0], models), models[1]);
	assert.throws(() => selectModel("p/missing", models[0], models), /unavailable/);
});

test("shouldProtectCaseAliasesWhenFilesystemMayBeCaseInsensitive", () => {
	// Given / When / Then
	for (const path of [".GIT/config", ".Pi/settings.json", "Extensions/guard.ts", "agents.md", "Package.JSON"]) {
		assert.throws(() => validateBatch([{ role: "implement", instruction: "change", files: [path] }]));
	}
});


function windowsFilesystem() {
	const entries = new Map([
		["C:\\repo\\src", "directory"], ["C:\\repo\\target", "file"], ["C:\\repo\\src\\target", "file"],
		["C:\\repo\\escape", "symlink"], ["C:\\repo\\hard", "hardlink"], ["C:\\skills\\chosen\\SKILL.md", "file"],
	]);
	return {
		paths: win32,
		realpath: async (path) => path,
		lstat: async (path) => {
			const kind = entries.get(win32.normalize(path));
			if (!kind) throw Object.assign(new Error("Fixture path missing"), { code: "ENOENT" });
			return { isSymbolicLink: () => kind === "symlink", isDirectory: () => kind === "directory", isFile: () => ["file", "hardlink"].includes(kind), nlink: kind === "hardlink" ? 2 : 1 };
		},
	};
}

test("shouldAcceptNativeWindowsPathsAndMatchNestedAssignmentsWhenGuardValidatesCallbacks", async () => {
	// Given
	const filesystem = windowsFilesystem();
	const manifest = { cwd: "C:\\repo", role: "implement", files: ["target", "src/target", "new/nested"], skills: [{ baseDir: "C:\\skills\\chosen" }] };
	// When
	const paths = await Promise.all([
		validatePath(manifest, "C:\\repo\\target", false, filesystem),
		validatePath(manifest, "C:\\repo\\target", true, filesystem),
		validatePath(manifest, "C:\\repo\\src\\target", true, filesystem),
		validatePath(manifest, "src/target", true, filesystem),
		validatePath(manifest, "new\\nested", true, filesystem),
		validatePath(manifest, win32.join(manifest.cwd, "src", "target"), false, filesystem),
		validatePath(manifest, "C:\\skills\\chosen\\SKILL.md", false, filesystem),
	]);
	// Then
	assert.deepEqual(paths, ["C:\\repo\\target", "C:\\repo\\target", "C:\\repo\\src\\target", "C:\\repo\\src\\target", "C:\\repo\\new\\nested", "C:\\repo\\src\\target", "C:\\skills\\chosen\\SKILL.md"]);
});

test("shouldNormalizeAssignmentsAndProtectMetadataWhenWindowsSeparatorsAreUsed", () => {
	// Given / When / Then
	assert.equal(concreteFile("src\\target", win32), "src/target");
	assert.equal(projectRelativePath("C:\\repo", "C:\\repo\\src\\target", win32), "src/target");
	assert.equal(protectedPath("src\\.GiT\\config"), true);
	for (const path of ["..\\target", "src/..\\target", "C:\\repo\\target", "C:target", ".git\\config", "target:stream"]) assert.throws(() => concreteFile(path, win32));
});

test("shouldRetainWindowsBoundariesWhenPathsUseMixedSeparatorsOrUnsafeLinks", async () => {
	// Given
	const filesystem = windowsFilesystem();
	const manifest = { cwd: "C:\\repo", role: "implement", files: ["target", "hard"], skills: [] };
	// When / Then
	for (const path of ["..\\outside", "src/..\\target", "C:\\outside\\secret", "C:target", "C:\\repo\\.git/config", "C:\\repo\\.pi\\settings.json", "C:\\repo\\escape\\secret"]) {
		await assert.rejects(validatePath(manifest, path, false, filesystem));
	}
	await assert.rejects(validatePath(manifest, "C:\\repo\\hard", true, filesystem), /Hard-linked/);
	await assert.rejects(validatePath(manifest, "C:\\repo\\unassigned", true, filesystem), /assigned/);
});
