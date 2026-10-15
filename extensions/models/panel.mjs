import { randomUUID } from "node:crypto";
import { ROLES, FIELDS, snapshot, save, readConfiguration, resolveAssignment, validateCatalog, validateSession, profileName } from "./store.mjs";

export const SESSION = "session";
const INHERIT = "inherit", KEEP = "keep current";
const modelKey = model => `${model.provider}/${model.id}`;
/** Execution modes a role may choose; none for the session, and implementers are always synchronous. */
export const modesFor = role => role === SESSION ? [] : role === "implement" ? ["sync"] : ["sync", "background"];

/** Asks one dialog per field; RPC clients have no combined terminal picker. */
async function pickSequentially(choose, { role, current, inherited, catalog, supported }) {
	const keep = role === SESSION ? KEEP : INHERIT;
	const ids = catalog.map(modelKey);
	const searchText = Object.fromEntries(catalog.map(model => [modelKey(model), `${model.provider} ${modelKey(model)} ${model.id} ${model.name ?? ""}`]));
	const model = await choose(`${role} · model (${keep}: ${inherited.model ?? "none"})`, [keep, ...ids], searchText);
	if (model === undefined) return;
	const chosen = model === keep ? null : model;
	const effective = catalog.find(item => modelKey(item) === (chosen ?? inherited.model));
	const reasoning = await choose(`${role} · effort (${keep}: ${inherited.reasoning ?? "none"}; off disables thinking)`, [keep, ...(effective ? supported(effective) : [])]);
	if (reasoning === undefined) return;
	const result = { model: chosen, reasoning: reasoning === keep ? null : reasoning };
	const modes = modesFor(role);
	if (modes.length > 1) {
		const mode = await choose(`${role} · mode (${keep}: ${inherited.mode})`, [keep, ...modes]);
		if (mode === undefined) return;
		result.mode = mode === keep ? null : mode;
	} else if (modes.length) result.mode = current.mode ?? null;
	return result;
}

/** One-screen profile editing shared by Pi's terminal and RPC selectors. */
export async function profilesPanel(ctx, files, supported, parent, isCurrent = () => true, ui = {}) {
	if (!ctx.hasUI) throw new Error("/models-profiles requires an interactive Pi UI");
	const select = ui.select ?? ((title, options) => ctx.ui.select(title, options));
	const projectTrusted = ctx.isProjectTrusted?.() === true;
	const checkContext = () => {
		if (!isCurrent()) throw new Error("Session changed; reopen the panel");
		if ((ctx.isProjectTrusted?.() === true) !== projectTrusted) throw new Error("Project trust changed; reopen the panel");
	};
	const choose = async (title, options, searchText) => { const value = await select(title, options, searchText); checkContext(); return value; };
	const pick = async request => { const value = ui.pickAssignment ? await ui.pickAssignment(request) : await pickSequentially(choose, request); checkContext(); return value; };
	let scope = "personal";
	let catalog = ctx.modelRegistry.getAvailable();
	let stored = await snapshot(files.profiles);
	let configuration = await readConfiguration(files, { projectTrusted });
	const profiles = structuredClone(stored.data.profiles ?? []);
	if (!Array.isArray(profiles)) throw new Error("Invalid profiles file");
	const layers = (assignments, target = scope) => [target === "project" ? assignments : configuration.project.data.assignments, target === "personal" ? assignments : configuration.personal.data.assignments];
	const sessionAfter = session => ({ ...parent, model: session?.model ?? parent.model, reasoning: session?.reasoning ?? parent.reasoning });
	while (isCurrent()) {
		const applied = configuration[scope].data.lastProfile;
		const labels = profiles.map((profile, i) => `${i + 1}. ${profile.id === applied ? "● " : ""}${profile.name}`);
		const switchScope = projectTrusted ? [`Scope: ${scope} → ${scope === "personal" ? "project" : "personal"}`] : [];
		const action = await choose(`Models profiles · ${scope}`, [...labels, "Create profile", ...switchScope, "Effective assignments", "Refresh catalog", "Close"]);
		if (!action || action === "Close") return;
		if (action === switchScope[0]) { scope = scope === "personal" ? "project" : "personal"; continue; }
		if (action === "Refresh catalog") { await ctx.modelRegistry.refresh(); catalog = ctx.modelRegistry.getAvailable(); continue; }
		if (action === "Effective assignments") {
			const lines = ROLES.map(role => { const { values, sources } = resolveAssignment(role, {}, configuration.project.data.assignments, configuration.personal.data.assignments, parent); return `${role}: ${FIELDS.map(field => `${field}=${values[field]} (${sources[field]})`).join(", ")}`; });
			await choose([`${SESSION}: model=${parent.model}, reasoning=${parent.reasoning}`, ...lines].join("\n"), ["Back"]); continue;
		}
		let profile = action === "Create profile" ? { id: randomUUID(), name: "", assignments: {} } : structuredClone(profiles[labels.indexOf(action)]);
		if (!profile) return;
		if (!profile.name) { const name = await ctx.ui.input("Profile name"); if (name === undefined) continue; profile.name = profileName(name); }
		let editing = true;
		while (editing && isCurrent()) {
			const saved = profiles.find(item => item.id === profile.id);
			const pending = changes(saved, profile);
			const [projectLayer, personalLayer] = layers(profile.assignments);
			const rows = [SESSION, ...ROLES].map(role => {
				if (role === SESSION) return `★ ${SESSION.padEnd(10)} ${profile.session?.model || profile.session?.reasoning ? describe(profile.session, parent) : `${KEEP} (${describe(parent)})`}`;
				const { values } = resolveAssignment(role, {}, projectLayer, personalLayer, sessionAfter(profile.session));
				const own = profile.assignments[role] ?? {};
				const shown = FIELDS.map(field => own[field] == null ? `↳ ${values[field] ?? "none"}` : values[field]);
				if (role === "implement") shown[2] = "sync";
				return `  ${role.padEnd(10)} ${shown.join(" · ")}`;
			});
			const commands = ["Save and apply", "Save profile", ...(saved ? ["Apply"] : []), "Rename", "Duplicate", ...(saved ? ["Delete"] : []), "Cancel"];
			const title = `Profile: ${profile.name} · ${scope}${pending ? ` · ${pending} unsaved change${pending === 1 ? "" : "s"}` : ""}\n↵ on a row edits model, effort and mode together · ↳ inherited`;
			const command = await choose(title, [...rows, ...commands]);
			if (!command || command === "Cancel") break;
			const row = rows.indexOf(command);
			if (row >= 0) {
				const role = [SESSION, ...ROLES][row];
				const current = role === SESSION ? { model: profile.session?.model ?? null, reasoning: profile.session?.reasoning ?? null }
					: { model: null, reasoning: null, mode: null, ...profile.assignments[role] };
				const inherited = role === SESSION ? parent : resolveAssignment(role, {}, ...layers({ ...profile.assignments, [role]: {} }), sessionAfter(profile.session)).values;
				const value = await pick({ role, current, inherited, catalog, supported, modes: modesFor(role) });
				if (value === undefined) continue;
				if (role === SESSION) {
					if (value.model == null && value.reasoning == null) delete profile.session;
					else profile.session = { model: value.model ?? null, reasoning: value.reasoning ?? null };
				}
				else {
					// Inheritance is the absence of an override; implementers are always synchronous.
					const next = Object.fromEntries(FIELDS.filter(field => value[field] != null && !(role === "implement" && field === "mode")).map(field => [field, value[field]]));
					if (Object.keys(next).length) profile.assignments[role] = next;
					else delete profile.assignments[role];
				}
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
				const session = profile.session ? structuredClone(profile.session) : undefined;
				const after = sessionAfter(session);
				const check = async () => {
					checkContext();
					catalog = ctx.modelRegistry.getAvailable();
					for (const old of [stored, configuration.personal, configuration.project]) if (!old.ignored && (await snapshot(old.path)).revision !== old.revision) throw new Error("Configuration changed concurrently; reopen the panel");
					validateSession(session, catalog, supported, parent);
					validateCatalog(assignments, catalog, supported, after, scope === "personal" ? assignments : configuration.personal.data.assignments, scope === "project" ? assignments : configuration.project.data.assignments);
				};
				await check();
				const diff = difference(configuration, layers(assignments), parent, after, command !== "Save profile");
				if (!await ctx.ui.confirm(command === "Save profile" ? `Save “${profile.name}”` : `Apply “${profile.name}” · ${scope}`, diff)) continue;
				await check();
				let saved = false;
				if (command !== "Apply") {
					const next = [...profiles.filter(item => item.id !== profile.id), profile];
					stored = await save(stored, { ...stored.data, profiles: next }); profiles.splice(0, profiles.length, ...next); saved = true;
				}
				if (command === "Save profile") { ctx.ui.notify(`Profile “${profile.name}” saved; applied assignments preserved`, "info"); editing = false; continue; }
				try {
					checkContext();
					const other = configuration[scope === "personal" ? "project" : "personal"];
					if (!other.ignored && (await snapshot(other.path)).revision !== other.revision) throw new Error("Configuration changed concurrently; reopen the panel");
					configuration[scope] = await save(target, { ...target.data, assignments, lastProfile: profile.id });
				}
				catch (error) { throw new Error(`${saved ? "Profile saved; configuration NOT applied" : "Configuration NOT applied"}: ${error.message}`); }
				if (session) {
					if (!ui.applySession) throw new Error("Subagent roles applied; this client cannot change the session model");
					try { await ui.applySession(session); }
					catch (error) { throw new Error(`Subagent roles applied; session model NOT changed: ${error.message}`); }
					parent = after;
				}
				ctx.ui.notify(`“${profile.name}” applied${session ? ` · session → ${describe(after)}` : ""} · new subtasks use its roles`, "info"); editing = false;
			}
		}
	}
}

function describe(values, fallback = {}) {
	return `${values?.model ?? `↳ ${fallback.model ?? "none"}`} · ${values?.reasoning ?? `↳ ${fallback.reasoning ?? "none"}`}`;
}

/** Fields that differ from the saved profile, so the editor can show unsaved work. */
function changes(saved, profile) {
	const flat = item => ({ name: item?.name, ...Object.fromEntries([SESSION, ...ROLES].flatMap(role =>
		FIELDS.map(field => [`${role}.${field}`, (role === SESSION ? item?.session : item?.assignments?.[role])?.[field] ?? null]))) });
	const before = flat(saved), now = flat(profile);
	return Object.keys(now).filter(key => before[key] !== now[key]).length;
}

/** Only the effective values that change, so the confirmation stays readable. */
function difference(configuration, [project, personal], parent, after, includeSession) {
	const lines = [];
	if (includeSession) for (const field of ["model", "reasoning"]) if (parent[field] !== after[field]) lines.push(`★ ${SESSION} ${field}: ${parent[field]} → ${after[field]}`);
	for (const role of ROLES) {
		const before = resolveAssignment(role, {}, configuration.project.data.assignments, configuration.personal.data.assignments, parent).values;
		const next = resolveAssignment(role, {}, project, personal, after).values;
		const changed = FIELDS.filter(field => before[field] !== next[field]).map(field => `${field}: ${before[field]} → ${next[field]}`);
		if (changed.length) lines.push(`${role} ${changed.join(", ")}`);
	}
	if (includeSession && lines.some(line => line.startsWith("★"))) lines.push("", "The session model changes now; roles affect new subtasks only.");
	return lines.length ? lines.join("\n") : "No effective changes.";
}
