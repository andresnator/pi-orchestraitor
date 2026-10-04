import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { createInterface } from "node:readline";

const raw = await readFile(process.argv[2], "utf8");
const manifest = JSON.parse(raw);
const mode = manifest.context;
const ready = { type: "guard_ready", id: manifest.id, digest: createHash("sha256").update(raw).digest("hex"),
	cwd: manifest.cwd, tools: manifest.tools, model: manifest.model, reasoning: manifest.reasoning };
const output = (event) => process.stdout.write(JSON.stringify(event) + "\n");
if (mode === "premature") process.exit(0);
if (mode !== "no-guard" && mode !== "startup-hang") process.send(mode === "bad-guard" ? { ...ready, digest: "wrong" } : ready);
if (mode === "ignore-term") process.on("SIGTERM", () => {});
const input = createInterface({ input: process.stdin });
input.on("line", async (line) => {
	const command = JSON.parse(line);
	if (command.type === "get_state") {
		const [provider, ...rest] = manifest.model.split("/");
		output({ type: "response", id: command.id, success: true, data: { model: { provider, id: rest.join("/") }, thinkingLevel: manifest.reasoning } });
	}
	if (command.type === "prompt") {
		if (manifest.timing) await writeFile(manifest.timing, JSON.stringify({ start: Date.now() }));
		if (manifest.marker) await writeFile(manifest.marker, "prompted");
		if (mode === "cancel-write") {
			await writeFile(join(manifest.cwd, manifest.files[0]), "changed before cancellation");
			process.send({ type: "file_changed" });
			return;
		}
		if (["hang", "ignore-term"].includes(mode)) return;
		if (mode === "early-end") { output({ type: "agent_end" }); process.exit(0); }
		if (mode === "write") process.send({ type: "write", path: manifest.files[0], phase: "completed" });
		await new Promise((resolve) => setTimeout(resolve, manifest.delay ?? 10));
		if (manifest.timing) { const timing = JSON.parse(await readFile(manifest.timing, "utf8")); await writeFile(manifest.timing, JSON.stringify({ ...timing, end: Date.now() })); }
		if (mode === "noisy") process.stderr.write("diagnostic".repeat(2000));
		const message = { type: "message_end", message: { role: "assistant", stopReason: mode === "provider-error" ? "error" : "stop",
			errorMessage: mode === "provider-error" ? "Fixture provider failed" : undefined,
			content: [{ type: "text", text: mode === "empty" ? "" : `result ${manifest.id} 你好 🧪` }] } };
		const bytes = Buffer.from(JSON.stringify(message) + "\n" + JSON.stringify({ type: "agent_settled" }) + "\n");
		for (let index = 0; index < bytes.length; index += 7) process.stdout.write(bytes.subarray(index, index + 7));
		if (mode === "duplicate") { output(message); output({ type: "agent_settled" }); }
	}
	if (command.type === "abort" && mode !== "ignore-term") {
		if (mode === "cancel-write") {
			// Notifications already produced by a write can arrive while abort is handled.
			for (const notification of [
				{ path: manifest.files[0], phase: "attempted" },
				{ path: manifest.files[0], phase: "completed" },
				{ path: manifest.files[0], phase: "attempted" },
				{ path: "unassigned", phase: "completed" },
				{ path: manifest.files[0], phase: "invalid" },
			]) await new Promise((resolve) => process.send({ type: "write", ...notification }, resolve));
			output({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Late success must be ignored" }] } });
			output({ type: "agent_settled" });
		}
		process.exit(0);
	}
});
input.on("close", () => { if (mode !== "ignore-term") process.exit(0); });
setInterval(() => {}, 1000);
