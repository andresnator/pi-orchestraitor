import { randomUUID } from "node:crypto";
import { ROLES, FIELDS, snapshot, save, readConfiguration, resolveAssignment, validateCatalog, profileName } from "./store.mjs";

/** Deterministic profile editing shared by Pi's terminal and RPC selectors. */
export async function profilesPanel(ctx, files, supported, parent, isCurrent = () => true, select = (title, options) => ctx.ui.select(title, options)) {
	if (!ctx.hasUI) throw new Error("/models-profiles requires an interactive Pi UI");
	const projectTrusted = ctx.isProjectTrusted?.() === true;
	const checkContext = () => {
		if (!isCurrent()) throw new Error("Session changed; reopen the panel");
		if ((ctx.isProjectTrusted?.() === true) !== projectTrusted) throw new Error("Project trust changed; reopen the panel");
	};
	const choose = async (title, options, searchText) => { const value = await select(title, options, searchText); checkContext(); return value; };
	const scope = await choose("Profile scope", projectTrusted ? ["personal", "project"] : ["personal"]);
	if (!scope) return;
	if (scope === "project" && !projectTrusted) throw new Error("Project profiles require native Pi project trust");
	let catalog = ctx.modelRegistry.getAvailable();
	let stored = await snapshot(files.profiles);
	let configuration = await readConfiguration(files, { projectTrusted });
	const profiles = structuredClone(stored.data.profiles ?? []);
	if (!Array.isArray(profiles)) throw new Error("Invalid profiles file");
	while (isCurrent()) {
		const applied = configuration[scope].data.lastProfile;
		const labels = profiles.map((profile, i) => `${i + 1}. ${profile.id === applied ? "● " : ""}${profile.name}`);
		const action = await choose("Models profiles", [...labels, "Create profile", "Refresh catalog", "Effective assignments", "Close"]);
		if (!action || action === "Close") return;
		if (action === "Refresh catalog") { await ctx.modelRegistry.refresh(); catalog = ctx.modelRegistry.getAvailable(); continue; }
		if (action === "Effective assignments") {
			const lines = ROLES.map(role => { const { values, sources } = resolveAssignment(role, {}, configuration.project.data.assignments, configuration.personal.data.assignments, parent); return `${role}: ${FIELDS.map(field => `${field}=${values[field]} (${sources[field]})`).join(", ")}`; });
			await choose(lines.join("\n"), ["Back"]); continue;
		}
		let profile = action === "Create profile" ? { id: randomUUID(), name: "", assignments: {} } : structuredClone(profiles[labels.indexOf(action)]);
		if (!profile) return;
		if (!profile.name) { const name = await ctx.ui.input("Profile name"); if (name === undefined) continue; profile.name = profileName(name); }
		let editing = true;
		while (editing && isCurrent()) {
			const command = await choose(`Profile: ${profile.name}`, [...ROLES, "Rename", "Duplicate", "Save and apply", "Save profile", ...(profiles.some(item => item.id === profile.id) ? ["Apply"] : []), "Delete", "Cancel"]);
			if (!command || command === "Cancel") break;
			if (ROLES.includes(command)) {
				const role = command;
				const field = await choose(`${role}: ${JSON.stringify(profile.assignments[role] ?? {})}`, FIELDS);
				if (!field) continue;
				const selected = resolveAssignment(role, {}, scope === "project" ? profile.assignments : configuration.project.data.assignments, scope === "personal" ? profile.assignments : configuration.personal.data.assignments, parent).values;
				const model = catalog.find(model => `${model.provider}/${model.id}` === selected.model);
				const options = field === "model" ? catalog.map(model => `${model.provider}/${model.id}`) : field === "reasoning" ? (model ? supported(model) : []) : role === "implement" ? ["sync"] : ["sync", "background"];
				const searchText = field === "model" ? Object.fromEntries(catalog.map(model => [`${model.provider}/${model.id}`, `${model.provider} ${model.provider}/${model.id} ${model.provider} ${model.id} ${model.name ?? ""}`])) : undefined;
				const value = await choose(`${role} / ${field}${field === "reasoning" ? " (off disables thinking)" : ""}`, ["inherit", ...options], searchText);
				if (value !== undefined) { profile.assignments[role] ??= {}; profile.assignments[role][field] = value === "inherit" ? null : value; }
				continue;
			}
			if (command === "Rename" || command === "Duplicate") {
				const name = await ctx.ui.input(command === "Rename" ? "New profile name" : "Duplicate profile name");
				if (name === undefined) continue;
				profile.name = profileName(name);
				if (command === "Duplicate") profile.id = randomUUID();
				continue;
			}
			if (command === "Delete") {
				if (!await ctx.ui.confirm("Delete profile?", "Applied assignments will be preserved.")) continue;
				checkContext();
				const next = profiles.filter(item => item.id !== profile.id);
				stored = await save(stored, { ...stored.data, profiles: next }); profiles.splice(0, profiles.length, ...next); editing = false; continue;
			}
			if (command === "Save and apply" || command === "Save profile" || command === "Apply") {
				if (profiles.some(item => item.id !== profile.id && item.name === profile.name)) throw new Error("Profile name already exists");
				const target = configuration[scope];
				if (command === "Apply") profile = structuredClone(profiles.find(item => item.id === profile.id));
				const assignments = structuredClone(profile.assignments);
				const check = async () => {
					checkContext();
					catalog = ctx.modelRegistry.getAvailable();
					for (const old of [stored, configuration.personal, configuration.project]) if (!old.ignored && (await snapshot(old.path)).revision !== old.revision) throw new Error("Configuration changed concurrently; reopen the panel");
					validateCatalog(assignments, catalog, supported, parent, scope === "personal" ? assignments : configuration.personal.data.assignments, scope === "project" ? assignments : configuration.project.data.assignments);
				};
				await check();
				const diff = ROLES.map(role => { const before = resolveAssignment(role, {}, configuration.project.data.assignments, configuration.personal.data.assignments, parent).values;
					const after = resolveAssignment(role, {}, scope === "project" ? assignments : configuration.project.data.assignments, scope === "personal" ? assignments : configuration.personal.data.assignments, parent).values;
					return `${role}: ${FIELDS.map(field => `${field}: ${before[field]} → ${after[field]}`).join(", ")}`; }).join("\n");
				if (!await ctx.ui.confirm(command === "Save profile" ? "Save profile" : "Apply profile", diff)) continue;
				await check();
				let saved = false;
				if (command !== "Apply") {
					const next = [...profiles.filter(item => item.id !== profile.id), profile];
					stored = await save(stored, { ...stored.data, profiles: next }); profiles.splice(0, profiles.length, ...next); saved = true;
				}
				if (command === "Save profile") { ctx.ui.notify("Profile saved; applied assignments preserved", "info"); editing = false; continue; }
				try {
					checkContext();
					const other = configuration[scope === "personal" ? "project" : "personal"];
					if (!other.ignored && (await snapshot(other.path)).revision !== other.revision) throw new Error("Configuration changed concurrently; reopen the panel");
					configuration[scope] = await save(target, { ...target.data, assignments, lastProfile: profile.id });
				}
				catch (error) { throw new Error(`${saved ? "Profile saved; configuration NOT applied" : "Configuration NOT applied"}: ${error.message}`); }
				ctx.ui.notify("Profile applied to new subtasks", "info"); editing = false;
			}
		}
	}
}
