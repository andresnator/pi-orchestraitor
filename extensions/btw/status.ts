import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { SideProgress, SideThinking } from "./types.ts";

/** Rough size of a token, only for estimates shown before the provider reports usage. */
const CHARS_PER_TOKEN = 4;
/** Rates over shorter windows are noise. */
const MIN_RATE_WINDOW_MS = 500;
const THINKING_PREVIEW_CHARS = 240;

const seconds = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
const tokens = (count: number) => count >= 1000 ? `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}k` : String(Math.round(count));

/** Phase and elapsed time, then details from most to least useful. */
export function progressParts(progress: SideProgress | undefined, now: number): [string, ...string[]] {
	if (!progress) return ["Ready"];
	const end = progress.endedAt ?? now;
	const elapsed = seconds(end - progress.startedAt);
	const firstToken = progress.firstTextAt === undefined ? [] : [`first token ${seconds(progress.firstTextAt - progress.startedAt)}`];
	switch (progress.phase) {
		case "sending": return [`◌ Sending ${elapsed}`];
		case "thinking": return [`◐ Thinking ${elapsed}`, `~${tokens(progress.thinking.length / CHARS_PER_TOKEN)} tok`];
		case "streaming": {
			const window = now - (progress.firstTextAt ?? now);
			const rate = window >= MIN_RATE_WINDOW_MS ? [`~${Math.round(progress.answerChars / CHARS_PER_TOKEN / (window / 1000))} tok/s`] : [];
			return [`◑ Streaming ${elapsed}`, ...firstToken, ...rate];
		}
		case "done": {
			const usage = progress.usage;
			const prompt = usage ? usage.input + usage.cacheRead + usage.cacheWrite : 0;
			const cache = prompt ? [`cache ${tokens(usage?.cacheRead ?? 0)}/${tokens(prompt)}`] : [];
			const output = usage?.output ? [`${tokens(usage.output)} tok`] : [];
			return [`✓ Done ${elapsed}`, ...firstToken, ...cache, ...output];
		}
		case "error": return [`✖ Error after ${elapsed}`];
		case "cancelled": return [`■ Cancelled after ${elapsed}`];
	}
}

/** One line describing the latest request: phase, elapsed time, speed, and cache use. */
export function formatProgress(progress: SideProgress | undefined, now: number): string {
	return progressParts(progress, now).join(" · ");
}

export interface StatusPart {
	text: string;
	/** Optional parts with lower numbers stay longer when space runs out; parts without one always show. */
	priority?: number;
}

/** Joins parts in order, keeping every required part plus the most important optional parts that fit. */
export function fitParts(parts: readonly StatusPart[], width: number): string {
	const kept = new Set(parts.filter(part => part.priority === undefined));
	const line = () => parts.filter(part => kept.has(part)).map(part => part.text).join(" · ");
	for (const part of parts.filter(part => part.priority !== undefined).sort((a, b) => a.priority! - b.priority!)) {
		kept.add(part);
		if (visibleWidth(line()) > width) kept.delete(part);
	}
	return line();
}

/** `low`, `off`, or `inherit:high`: the requested mode plus what inherit resolves to. */
export function formatThinking(thinking: SideThinking, level: ModelThinkingLevel): string {
	return thinking === "inherit" ? `inherit:${level}` : thinking === level ? level : `${thinking}→${level}`;
}

/** Latest reasoning as one line, for the optional preview under a pending answer. */
export function thinkingPreview(thinking: string): string {
	const flat = thinking.replace(/\s+/g, " ").trim();
	return flat.length > THINKING_PREVIEW_CHARS ? `…${flat.slice(-THINKING_PREVIEW_CHARS)}` : flat;
}
