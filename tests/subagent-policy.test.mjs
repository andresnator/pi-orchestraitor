import assert from "node:assert/strict";
import { mkdir, writeFile, symlink, link, realpath } from "node:fs/promises";
import { join, win32 } from "node:path";
import test from "node:test";
import { createWorkspace, pi } from "./helpers/pi-host.mjs";
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


test("shouldAllowOnlySelectedProjectSkillDirectoriesWhenHarnessMetadataIsProtected", async (t) => {
	// Given
	const cwd = await realpath(await createWorkspace(t));
	const baseDir = join(cwd, ".agents", "skills", "selected");
	await mkdir(join(baseDir, "references"), { recursive: true });
	await mkdir(join(baseDir, ".git"));
	const filePath = join(baseDir, "SKILL.md");
	const resource = join(baseDir, "references", "guide.md");
	await writeFile(filePath, "Selected native instructions.");
	await writeFile(resource, "Selected native resource.");
	await symlink(cwd, join(baseDir, "references", "escape"));
	const manifest = { cwd, role: "implement", files: ["output.txt"], skills: [{ baseDir, filePath }] };
	// When / Then
	assert.equal(await validatePath(manifest, filePath), filePath);
	assert.equal(await validatePath(manifest, resource), resource);
	for (const path of [".agents/settings.json", ".pi/settings.json", ".agents/skills/other/SKILL.md", join(baseDir, ".git/config"), join(baseDir, "references/escape")]) {
		await assert.rejects(validatePath(manifest, path));
	}
	await assert.rejects(validatePath(manifest, filePath, true));
	const metadata = join(cwd, ".agents", "settings.json");
	await writeFile(metadata, "Synthetic protected configuration.");
	const broad = { ...manifest, skills: [{ baseDir: join(cwd, ".agents"), filePath: join(cwd, ".agents", "SKILL.md") }] };
	await assert.rejects(validatePath(broad, metadata), /Protected/);
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

for (const host of [".agents", ".pi", ".codex"]) {
	test(`shouldNotExemptThe${host}CollectionWhenAStandaloneNativeSkillIsSelected`, async (t) => {
		const cwd = await realpath(await createWorkspace(t)), collection = join(cwd, host, "skills");
		await mkdir(join(collection, "other"), { recursive: true });
		const filePath = join(collection, "selected.md"), sibling = join(collection, "other", "SKILL.md");
		await writeFile(filePath, "---\nname: selected\ndescription: Selected standalone fixture.\n---\nSelected instructions.\n");
		await writeFile(sibling, "Unselected skill instructions.");
		const { skills } = pi.loadSkills({ cwd, skillPaths: [filePath], includeDefaults: false });
		assert.equal(skills.length, 1);
		assert.equal(skills[0].baseDir, collection);
		const manifest = { cwd, role: "explore", skills };
		for (const path of [sibling, collection, filePath]) await assert.rejects(validatePath(manifest, path), /Protected/);
	});
}

test("shouldRequireAConcreteSkillDirectoryForWindowsProtectedRootExemptions", async () => {
	const filesystem = { paths: win32, realpath: async (path) => path,
		lstat: async () => ({ isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false }) };
	const collection = "C:\\repo\\.agents\\skills", baseDir = win32.join(collection, "chosen");
	const manifest = { cwd: "C:\\repo", role: "explore", skills: [{ baseDir: collection }] };
	await assert.rejects(validatePath(manifest, win32.join(collection, "other", "SKILL.md"), false, filesystem), /Protected/);
	assert.equal(await validatePath({ ...manifest, skills: [{ baseDir }] }, win32.join(baseDir, "SKILL.md"), false, filesystem), win32.join(baseDir, "SKILL.md"));
});

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
